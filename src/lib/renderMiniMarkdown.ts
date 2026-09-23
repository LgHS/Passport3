// Deliberately not a real Markdown engine — just **bold**, *italic* and __underline__, the three
// the wishlist description needs. Escaping happens before any tag is added, so anything the member
// types (including literal < > & characters, or an attempt at raw HTML) is inert text by the time
// our own three regexes run, never live markup.
function escapeHtml(raw: string): string {
	return raw
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

export function renderMiniMarkdown(raw: string): string {
	return escapeHtml(raw)
		.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
		.replace(/__(.+?)__/g, '<u>$1</u>')
		.replace(/\*(.+?)\*/g, '<em>$1</em>');
}
