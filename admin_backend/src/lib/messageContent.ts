const MESSAGE_HTML_TAG_PATTERN = /<\/?[A-Za-z][A-Za-z0-9:-]*(?:\s[^<>\r\n]*)?\/?>/g;

const escapeTagToken = (value: string) => value.replace(/</g, '&lt;').replace(/>/g, '&gt;');

export const sanitizeMessageContent = (value: string) =>
  value
    .replace(/\r\n?/g, '\n')
    .replace(/\u0000/g, '')
    .replace(MESSAGE_HTML_TAG_PATTERN, escapeTagToken)
    .trim();

export const isMessageContentWithinLimit = (value: string, maxLength: number) =>
  value.length <= maxLength && sanitizeMessageContent(value).length <= maxLength;
