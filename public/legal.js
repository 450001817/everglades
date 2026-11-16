// The legal pages name the support contact (goblininksupport@gmail.com) in their HTML. Setting SUPPORT_EMAIL on the
// server replaces it with another address without editing the pages.
fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  .then(r => r.json())
  .then(c => {
    const email = c && c.supportEmail;
    document.querySelectorAll('[data-contact]').forEach(el => {
      if (email) { el.textContent = ''; const a = document.createElement('a'); a.href = 'mailto:' + email; a.textContent = email; el.appendChild(a); }
    });
  })
  .catch(() => {});
