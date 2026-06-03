// Roll for Rating — marketing site interactions (vanilla, no deps).

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

// Waitlist form.
// No backend yet, so this opens the visitor's mail client addressed to us with
// their email pre-filled. To collect signups automatically later, point this at
// a form service (Formspree, Buttondown, ConvertKit) or a Supabase insert —
// see website/README.md.
const WAITLIST_EMAIL = 'hello@rollforrating.com';
const form = document.getElementById('waitlist');
const msg = document.getElementById('formMsg');
if (form) {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const email = (form.querySelector('input[name="email"]').value || '').trim();
    if (!email) return;
    const subject = encodeURIComponent('Roll for Rating waitlist');
    const body = encodeURIComponent(`Add me to the Roll for Rating waitlist: ${email}`);
    window.location.href = `mailto:${WAITLIST_EMAIL}?subject=${subject}&body=${body}`;
    if (msg) msg.textContent = "Thanks! Your email app should open — hit send and you're on the list.";
    form.reset();
  });
}
