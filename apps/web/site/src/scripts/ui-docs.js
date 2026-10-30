for (const button of document.querySelectorAll('[data-ui-dialog-open]')) {
  const dialog = document.getElementById(button.getAttribute('data-ui-dialog-open'));

  if (dialog instanceof HTMLDialogElement) {
    button.disabled = false;
    button.addEventListener('click', () => {
      if (!dialog.open) {
        dialog.showModal();
      }
    });
  }
}

for (const button of document.querySelectorAll('[data-ui-validate]')) {
  const fields = document.getElementById(button.getAttribute('data-ui-validate'));

  if (!fields) {
    continue;
  }

  const controls = Array.from(fields.querySelectorAll('input'));
  const status = fields.querySelector('[data-ui-validation-status]');

  function update() {
    for (const control of controls) {
      const invalid = !control.validity.valid;

      control.setAttribute('aria-invalid', String(invalid));
    }
  }

  for (const control of controls) {
    control.addEventListener('input', update);
  }

  button.addEventListener('click', () => {
    fields.setAttribute('data-submitted', '');
    update();
    const invalid = controls.find((control) => !control.validity.valid);

    status.textContent = invalid ? status.getAttribute('data-invalid') : status.getAttribute('data-valid');
    invalid?.reportValidity();
  });
}
