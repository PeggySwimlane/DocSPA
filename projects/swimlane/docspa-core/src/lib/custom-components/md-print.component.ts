import { Component, Input, OnInit, HostBinding } from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import { of } from 'rxjs';
import { flatMap, map } from 'rxjs/operators';

import unified from 'unified';
import markdown from 'remark-parse';
import visit from 'unist-util-visit';
import stringify from 'remark-stringify';
import toString from 'mdast-util-to-string';
import slug from 'remark-slug';
import { MDAST } from 'mdast';
import VFile from 'vfile';
import frontmatter from 'remark-frontmatter';
import html from 'remark-html';

import { images } from '../plugins/links';

import { LocationService } from '../services/location.service';
import { FetchService } from '../services/fetch.service';
import { SettingsService } from '../services/settings.service';
import { RouterService } from '../services/router.service';

import { join } from '../utils';

@Component({
  selector: 'docspa-print', // tslint:disable-line
  template: `{{paths | json}}`,
  styles: []
})
export class MdPrintComponent implements OnInit {
  static readonly is = 'md-print';

  @Input()
  summary = '';

  @Input()
  set paths(val: string[]) {
    if (typeof val === 'string') {
      val = (val as string).split(',');
    }
    if (!Array.isArray(val)) {
      val = [val];
    }
    this._paths = val;
  }
  get paths(): string[] {
    return this._paths;
  }

  @HostBinding('innerHTML')
  html: string | SafeHtml;

  safe = true;

  private processor: any;
  private processLinks: any;
  private _paths: string[];
  private page = '';

  constructor (
    private settings: SettingsService,
    private routerService: RouterService,
    private fetchService: FetchService,
    private locationService: LocationService,
    private sanitizer: DomSanitizer
  ) {
    const getLinks = () => {
      return (tree: any, file: VFile) => {
        file.data = file.data || {};
        file.data.tocSearch = [];
        visit(tree, 'link', (node: MDAST.Link) => {
          const url = node.url;
          const content = toString(node);
          const name = (file.data.matter ? file.data.matter.title : false) || file.data.title || file.path;
          file.data.tocSearch.push({
            name,
            url,
            content,
            depth: (node as any).depth
          });
          return true;
        });
      };
    };

    const fixLinks = () => {
      return (tree, file: VFile) => {
        visit(tree, 'link', (node: MDAST.Link) => {
          if (node && !LocationService.isAbsolutePath(node.url)) {
            const url = locationService.prepareLink(node.url, file.history[0]).replace(/[\/#]/g, '--');
            node.url = `${this.page}#${url}`;
          }
          return true;
        });
      };
    };

    const fixIds = () => {
      return (tree, file: VFile) => {
        visit(tree, 'heading', (node: MDAST.Heading) => {
          if (node && node.data && node.data.hProperties && node.data.hProperties.id) {
            const id = locationService.prepareLink(`#${node.data.hProperties.id}`, file.history[0]).replace(/[\/#]/g, '--');
            node.data.hProperties.id = node.data.id = id;
          }
          return true;
        });
      };
    };

    this.processLinks = unified()
      .use(markdown)
      .use(frontmatter)
      .use(slug)
      .use(getLinks)
      .use(stringify);

    this.processor = unified()
      .use(markdown)
      .use(this.settings.remarkPlugins)
      .use(fixLinks)
      .use(fixIds)
      .use(images, locationService)
      .use(html);
  }

  ngOnInit() {
    this.page = this.routerService.contentPage;
    if (this.summary) {
      this.load();
    }
  }

  private async load() {
    const paths = await this.loadSummary(this.summary);

    this.paths = [this.summary, ...paths];

    if (this.settings.coverpage) {
      this.paths.unshift(this.settings.coverpage);
    }

    const p = this.paths.map(async (path: string) => {
      const vfile = this.locationService.pageToFile(path);
      const url = join(vfile.cwd, vfile.path);
      const res = await this.fetchService.get(url).toPromise();
      vfile.contents = res.contents;
      return this.processor.process(vfile);
    });

    const files = await Promise.all(p);
    const contents = files.map(f => {
      const id = f.history[0].replace(/^\//, '');
      return `<a id="--${id}"></a><a id="${id}"></a>${f.contents}<hr>`;
    }).join('\n\n');

    this.html = this.safe ? this.sanitizer.bypassSecurityTrustHtml(contents) : contents;
  }

  private loadSummary(summary: string): Promise<string[]> {
    const vfile = this.locationService.pageToFile(summary);
    const fullPath = join(vfile.cwd, vfile.path);
    return this.fetchService.get(fullPath).pipe(
      flatMap(resource => {
        vfile.contents = resource.contents;
        vfile.data = vfile.data || {};
        return resource.notFound ? of(null) : this.processLinks.process(vfile);
      }),
      map((_: any) => {
        return _.data.tocSearch.map(__ => {
          return __.url[0] === '/' ? __.url : '/' + __.url;
        });
      })
    ).toPromise();
  }
}


