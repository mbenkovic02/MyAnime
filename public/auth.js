// Auth logic for both Login and Register pages
document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('form');
  if (!form) return;

  const isRegister = !!document.getElementById('first_name'); // if first_name exists → register page
  const errEl = document.getElementById('err');
  const btn = document.getElementById('btn');

  form.addEventListener('submit', async (e) => {   //includes enter and button
    e.preventDefault();                               // spriječi da forma pošalje POST i reloada stranicu
    errEl.textContent = '';
    btn.disabled = true;

    try {
      if (isRegister) {
        // --- REGISTER ---
        const payload = {
          first_name: document.getElementById('first_name').value.trim(),
          last_name:  document.getElementById('last_name').value.trim(),
          email:      document.getElementById('email').value.trim(),
          password:   document.getElementById('password').value
        };

        const res = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const data = await res.json().catch(() => ({}));
        if (res.ok && (data.success !== false)) {
          if (data.role === 'admin') {
            // first user becomes admin → go to dashboard
            location.href = 'admin.html';
          } else {
            location.href = 'index.html';
          }
        } else {
          errEl.textContent = data.error || 'Registration error.';
        }
      } else {
        // --- LOGIN ---
        const email = document.getElementById('email').value.trim();
        const password = document.getElementById('password').value;

        const res = await fetch('/api/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password })
        });

        const data = await res.json().catch(() => ({}));
        if (res.ok && (data.success !== false)) {
          if (data.role === 'admin') {
            location.href = 'admin.html';
          } else {
            location.href = 'index.html';
          }
        } else {
          errEl.textContent = data.error || 'Login error.';
        }
      }
    } catch (e) {
      errEl.textContent = 'Network error. Please try again.';
    } finally {
      btn.disabled = false;
    }
  });
});
