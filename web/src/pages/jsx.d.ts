/** Attributes HTML allows that @kitajs/html's element types leave out. */
declare namespace JSX {
  interface HtmlMetaTag {
    /** theme-color takes a media query, to differ by color scheme. */
    media?: undefined | string;
  }
  /** How wide the layout shows an image, for its `srcset` widths. */
  interface HtmlImageTag {
    sizes?: undefined | string;
  }
  interface HtmlSourceTag {
    sizes?: undefined | string;
  }
}
