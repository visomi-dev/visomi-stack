const demo = document.querySelector('[data-button-demo]');
const count = demo.querySelector('[data-count]');

demo.querySelector('[data-increment]').addEventListener('click', () => {
  count.textContent = String(Number(count.textContent) + 1);
});
demo.querySelector('[data-reset]').addEventListener('click', () => {
  count.textContent = '0';
});
