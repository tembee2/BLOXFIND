document.getElementById('copy-results').addEventListener('click', () => {
const list = document.querySelectorAll('#list .item');
if (!list.length){
alert('No results to copy');
return;
}
let lines = [];
list.forEach(div => {
const link = div.querySelector('a');
if (link){
const name = link.textContent;
const href = link.href;
const idMatch = href.match(/users\/(\d+)\//);
const id = idMatch ? idMatch[1] : '';
lines.push(`${name}: ${id} (${href}),`);
}
});
const text = lines.join("\n");
navigator.clipboard.writeText(text).then(() => {
alert('Copied ' + lines.length + ' users to clipboard');
}).catch(err => {
console.error('Copy failed', err);
alert('Copy failed');
});
});