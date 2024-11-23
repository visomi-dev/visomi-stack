import { Injectable, LOCALE_ID, inject } from '@angular/core';
import { Meta, Title } from '@angular/platform-browser';

@Injectable({
  providedIn: 'root',
})
export class SeoService {
  private readonly meta = inject(Meta);
  private readonly title = inject(Title);
  private readonly locale = inject(LOCALE_ID);

  /**
   * Sets the page title, description, preview image, and other metadata.
   * This is used by search engines and social media when sharing a link.
   * It also sets whether the page should be indexed or followed by search engines.
   *
   * @param url - The URL of the page.
   * @param title - The title of the page.
   * @param description - The description of the page.
   * @param preview - The preview of the page (must be a URL or relative absolute assets path).
   * @param index - Whether or not to index the page.
   * @param follow - Whether or not to follow links on the page.
   * @returns void
   * @example
   * ```ts
   * this.seo.configure({
   *  url: 'https://example.com',
   *  title: 'Example',
   *  description: 'This is an example.',
   *  preview: '/assets/previews/preview.webp',
   *  index: true,
   *  follow: true,
   * });
   * ```
   */
  configure({
    title,
    description,
    url,
    preview,
    index = false,
    follow = false,
    robots = [],
    keywords,
    subject,
    copyright,
    abstract,
    topic,
    author,
    owner,
  }: {
    url: string;
    title: string;
    description: string;
    preview: string;
    index?: boolean;
    follow?: boolean;
    robots?: string[];
    keywords?: string;
    subject?: string;
    copyright?: string;
    abstract?: string;
    topic?: string;
    author?: string;
    owner?: string;
  }) {
    this.title.setTitle(title);

    [
      {
        name: 'description',
        content: description,
      },
      {
        name: 'og:url',
        content: url,
      },
      {
        name: 'og:title',
        content: title,
      },
      {
        name: 'og:description',
        content: description,
      },
      {
        name: 'og:image',
        content: preview,
      },
      {
        name: 'twitter:url',
        content: url,
      },
      {
        name: 'twitter:title',
        content: title,
      },
      {
        name: 'twitter:description',
        content: description,
      },
      {
        name: 'twitter:image',
        content: preview,
      },
      {
        name: 'keywords',
        content: keywords,
      },
      {
        name: 'subject',
        content: subject,
      },
      {
        name: 'copyright',
        content: copyright,
      },
      {
        name: 'language',
        content: this.locale,
      },
      {
        name: 'abstract',
        content: abstract,
      },
      {
        name: 'topic',
        content: topic,
      },
      {
        name: 'author',
        content: author,
      },
      {
        name: 'owner',
        content: owner,
      },
      {
        name: 'robots',
        content: [
          index ? 'index' : 'noindex',
          follow ? 'follow' : 'nofollow',
          ...robots,
        ].join(', '),
      },
    ].forEach(({ name, content }) => {
      const tag = this.meta.getTag(`name="${name}"`);

      if (tag && content) {
        this.meta.removeTagElement(tag);

        this.meta.addTag({ name, content });
      } else if (content) {
        this.meta.addTag({ name, content });
      }
    });
  }
}
