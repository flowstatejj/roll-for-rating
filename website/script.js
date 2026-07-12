// Roll for Rating - marketing site interactions (vanilla, no deps).

// Current year in footer
document.getElementById('year').textContent = String(new Date().getFullYear());

// Mobile nav toggle
const toggle = document.querySelector('.nav-toggle');
const mobile = document.querySelector('.nav-mobile');
if (toggle && mobile) {
  toggle.addEventListener('click', () => {
    const open = mobile.classList.toggle('open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  mobile.querySelectorAll('a').forEach((a) =>
    a.addEventListener('click', () => {
      mobile.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    }),
  );
}

// Invite code banner.
// Share links from the app land here as ?ref=CODE (friend invite) or
// ?elite=CODE (Elite free-access invite). Show the code prominently so the
// visitor can install the app and enter it on the sign-up screen.
(function () {
  const params = new URLSearchParams(window.location.search);
  const isElite = !!(params.get('elite') || '').trim();
  const raw = isElite ? params.get('elite') : params.get('ref');
  if (!raw) return;

  // Sanitize: uppercase, alphanumerics only, max 12 chars.
  const code = raw.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12);
  if (!code) return;

  function copyCode(btn) {
    const done = () => {
      btn.textContent = 'Copied!';
      btn.disabled = true;
      setTimeout(() => {
        btn.textContent = 'Copy';
        btn.disabled = false;
      }, 1800);
    };
    const fallback = () => {
      // Older browsers / non-secure contexts: temp textarea + execCommand.
      const ta = document.createElement('textarea');
      ta.value = code;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.top = '-1000px';
      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, code.length);
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch (err) {
        ok = false;
      }
      document.body.removeChild(ta);
      if (ok) done();
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done).catch(fallback);
    } else {
      fallback();
    }
  }

  // Built with createElement/textContent only - no HTML injection possible.
  const banner = document.createElement('div');
  banner.className = 'invite-banner' + (isElite ? ' elite' : '');

  const inner = document.createElement('div');
  inner.className = 'container invite-inner';

  const text = document.createElement('div');
  text.className = 'invite-text';

  const title = document.createElement('div');
  title.className = 'invite-title';
  title.textContent = isElite ? 'Your Elite invite code:' : 'Your invite code:';

  const codeEl = document.createElement('span');
  codeEl.className = 'invite-code';
  codeEl.textContent = code;
  title.appendChild(codeEl);

  const sub = document.createElement('div');
  sub.className = 'invite-sub';
  sub.textContent = isElite
    ? 'It gives you free access. Install the app, then enter it at sign-up.'
    : 'Install the app, then enter this code on the sign-up screen.';

  text.appendChild(title);
  text.appendChild(sub);

  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.className = 'btn btn-sm invite-copy';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', () => copyCode(copyBtn));

  inner.appendChild(text);
  inner.appendChild(copyBtn);
  banner.appendChild(inner);

  const header = document.querySelector('header.nav');
  if (header && header.parentNode) {
    header.parentNode.insertBefore(banner, header.nextSibling);
  } else {
    document.body.insertBefore(banner, document.body.firstChild);
  }
})();
