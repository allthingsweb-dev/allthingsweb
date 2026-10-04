/** Attributes HTML allows that @kitajs/html's element types leave out. */
declare namespace JSX {
  interface HtmlMetaTag {
    /** theme-color takes a media query, to differ by color scheme. */
    media?: undefined | string;
  }
}
