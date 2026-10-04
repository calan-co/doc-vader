/**
 * Supported link types in Linkity.
 */
type LinkType = "wikilink" | "markdown" | "url" | "custom";
/**
 * Represents a parsed link and its metadata.
 *
 * Extensible for future context fields (e.g., inCode, inHeading, headingLevel, inline).
 * All fields except `type` and `value` are optional for compatibility with current and future parsers.
 *
 * Example usage:
 *   {
 *     type: "markdown",
 *     value: "[Link](https://example.com)",
 *     url: "https://example.com",
 *     position: { start: 10, end: 32 },
 *     context: { inHeading: true, headingLevel: 2 }
 *   }
 */
interface LinkNode {
    /** Link type (wikilink, markdown, url, custom) */
    type: LinkType;
    /** Raw link text as found in source */
    value: string;
    /** Optional alias or display text */
    alias?: string;
    /** Parsed URL (if available) */
    url?: string;
    /** Character offsets in original string */
    position?: {
        start: number;
        end: number;
    };
    /** Arbitrary parser-specific data */
    data?: Record<string, any>;
    /**
     * Optional context metadata for richer link info.
     * - inCode: true if link is inside a code block/span
     * - inHeading: true if link is inside a heading
     * - headingLevel: heading level (if inHeading)
     * - inline: true if link is inline (not block)
     */
    context?: {
        inCode?: boolean;
        inHeading?: boolean;
        headingLevel?: number;
        inline?: boolean;
        [key: string]: any;
    };
}
interface LinkityParseOptions {
    enableWikilink?: boolean;
    enableMarkdown?: boolean;
    enableUrl?: boolean;
    customSchemes?: string[];
}

declare function parseWikilink(_text: string): LinkNode[];

declare function parseMarkdownLink(_text: string): LinkNode[];

declare function parseRawUrl(_text: string): LinkNode[];

/**
 * Utility to detect link type from a string
 */
declare function detectLinkType(_str: string): LinkType | null;

/**
 * Parses input text and returns an array of LinkNode ASTs for all detected links.
 * Supports wikilinks ([[Page]]), markdown links [text](url), and raw URLs.
 * @param text Input string
 * @param options Parsing options
 */
declare function parseLinks(text: string, options?: LinkityParseOptions): LinkNode[];

export { type LinkNode, type LinkType, type LinkityParseOptions, detectLinkType, parseLinks, parseMarkdownLink, parseRawUrl, parseWikilink };
