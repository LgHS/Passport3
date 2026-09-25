// Neutral silhouette (128x128 PNG, 431 bytes) served by /avatars/[file] when neither an uploaded
// photo nor a Gravatar can be returned, so that URL always answers with an image. Embedded rather
// than read from static/, which isn't reliably on disk next to the server bundle.
export const DEFAULT_AVATAR_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAABdklEQVR42u3csVEDURBEwck/BjwCICoKgyTkYWOcbvb+dtVE8LqEIf0l3z+/VlwkAADAAAAwAAAMAAADAMAAADAAAAwAAAMAwAAAMAAADAAAAwDAAPzt4/MLwK25/zMAne5PlMip6Z/CkOPrDzfIhvqTDbIh/WSGrKo/0AAAgHvrTzPIwvqjDLKz/hwDAABK9YcYAAAAYG39CQYAAAAAAAAAgJ0A9fp1A58Af4IAAAAAAAAAAL4NBQAAgN+E/SYMwLsg74K8jPM21NtQAO4D3Ae4kHEj5kbMlaQ7YXfCLuUB+F8RBgCAAQBgAAAYAAAGAIABAPDYy6QJX6NG+i5D1O8aRP2uQdTvGkT9rkHU7xpE/a5B1O8aADgU4LD67zOI+l0DAMcBHFz/HQZRv2sA4CCAJfWvNQBwCsCq+hcaADgCYGH9qwwAPB9gbf1LDAAAAKB+0QAAAADqFw0AAAAAAAAA9UsGAAAAAAAAAAAAAAAAAADgZoAXKxulu4cHabIAAAAASUVORK5CYII=',
	'base64'
);
