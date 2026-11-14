// Fills in the support contact on the legal pages (SUPPORT_EMAIL on the server). Without it, the pages point
// players to the support contact shown on their Stripe receipt.
fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
  .then(r => r.json())
  .then(c => {
    const email = c && c.supportEmail;
    document.querySelectorAll('[data-contact]').forEach(el => {
      if (email) { el.textContent = ''; const a = document.createElement('a'); a.href = 'mailto:' + email; a.textContent = email; el.appendChild(a); }
    });
  })
  .catch(() => {});
