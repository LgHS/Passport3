// Turns the ROI's Markdown (roi.md) into plain blocks the page renders itself, without {@html}.
// Only the little Markdown the ROI uses is understood: `##` chapters, `###` articles, paragraphs,
// `-` and `1.` lists, one level of nested `-` list, and **bold**.

export type Inline = { text: string; bold: boolean }[];
export type Block =
	| { kind: 'p'; text: Inline }
	| { kind: 'ul' | 'ol'; items: { text: Inline; sub: Inline[] }[] };
export type Article = { title: string; blocks: Block[] };
export type Chapter = { title: string; intro: Block[]; articles: Article[] };

export function inline(text: string): Inline {
	return text.split(/(\*\*[^*]+\*\*)/).filter(Boolean).map((part) =>
		part.startsWith('**') && part.endsWith('**')
			? { text: part.slice(2, -2), bold: true }
			: { text: part, bold: false }
	);
}

export function parseRoi(md: string): Chapter[] {
	const chapters: Chapter[] = [];
	let blocks: Block[] | null = null;
	let list: Extract<Block, { kind: 'ul' | 'ol' }> | null = null;

	for (const raw of md.split('\n')) {
		const line = raw.trimEnd();
		if (line.startsWith('## ')) {
			chapters.push({ title: line.slice(3), intro: [], articles: [] });
			blocks = chapters.at(-1)!.intro;
			list = null;
		} else if (line.startsWith('### ')) {
			const chapter = chapters.at(-1);
			if (!chapter) continue;
			chapter.articles.push({ title: line.slice(4), blocks: [] });
			blocks = chapter.articles.at(-1)!.blocks;
			list = null;
		} else if (!blocks || line === '') {
			list = null;
		} else if (/^\s+- /.test(line) && list) {
			list.items.at(-1)?.sub.push(inline(line.replace(/^\s+- /, '')));
		} else if (/^(- |\d+\. )/.test(line)) {
			const kind = line.startsWith('- ') ? 'ul' : 'ol';
			if (!list || list.kind !== kind) {
				list = { kind, items: [] };
				blocks.push(list);
			}
			list.items.push({ text: inline(line.replace(/^(- |\d+\. )/, '')), sub: [] });
		} else {
			blocks.push({ kind: 'p', text: inline(line) });
			list = null;
		}
	}
	return chapters;
}
