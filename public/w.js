/* real.clicks quote form. <div data-real-clicks data-niche="gpu|security"></div>
   <script src="https://real.clicks.pit.world/w.js" defer></script>
   SPAs: call window.RealClicks.scan() after adding a container.
   CSP-friendly: no eval, no inline script or style; needs script-src, style-src and
   connect-src https://real.clicks.pit.world on the host page. */
(function () {
  var BASE = 'https://real.clicks.pit.world';
  function scan() {
  var nodes = document.querySelectorAll('[data-real-clicks]:not([data-rc-ready])');
  if (!nodes.length) return;
  if (!document.querySelector('link[data-rc-css]')) {
    var css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = BASE + '/w.css';
    css.setAttribute('data-rc-css', '');
    document.head.appendChild(css);
  }
  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function field(form, name, label, type, opts) {
    var wrap = el('label', 'rc-f');
    wrap.appendChild(el('span', 'rc-l', label));
    var input;
    if (type === 'textarea') input = el('textarea');
    else if (type === 'select') {
      input = el('select');
      opts.forEach(function (o) { var op = el('option', null, o); op.value = o; input.appendChild(op); });
    } else { input = el('input'); input.type = type; }
    input.name = name;
    if (opts && opts.required) input.required = true;
    wrap.appendChild(input);
    form.appendChild(wrap);
    return input;
  }
  function post(path, body) {
    return fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || 'Something went wrong'); return j; }); });
  }
  Array.prototype.forEach.call(nodes, function (root) {
    root.setAttribute('data-rc-ready', '');
    var niche = root.getAttribute('data-niche') === 'security' ? 'security' : 'gpu';
    fetch(BASE + '/api/v1/offer?niche=' + niche).then(function (r) { return r.json(); }).then(function (offer) {
      if (!offer.available) return;
      var box = el('div', 'rc-box');
      box.appendChild(el('div', 'rc-h', root.getAttribute('data-title') || offer.title));
      var form = el('form', 'rc-form');
      form.noValidate = false;
      var sig = { interactions: 0, keys: 0, webdriver: navigator.webdriver === true };
      ['pointerdown', 'touchstart', 'focusin'].forEach(function (t) { form.addEventListener(t, function (e) { if (e.isTrusted) sig.interactions++; }, { passive: true }); });
      form.addEventListener('keydown', function (e) { if (e.isTrusted) { sig.keys++; sig.interactions++; } });
      var need = field(form, 'need', niche === 'gpu' ? 'What do you need? (GPUs, CPUs, RAM, location, how long)' : 'What should be tested? (web app, API, network, cloud, compliance)', 'textarea', { required: true });
      need.rows = 3; need.maxLength = 2000;
      var budget = field(form, 'budget', 'Budget', 'select', ['Not sure', niche === 'gpu' ? 'Under $500/mo' : 'Under $5k', niche === 'gpu' ? '$500 to $2k/mo' : '$5k to $15k', niche === 'gpu' ? '$2k to $10k/mo' : '$15k to $50k', niche === 'gpu' ? 'Over $10k/mo' : 'Over $50k']);
      var timeline = field(form, 'timeline', 'When', 'select', ['This week', 'This month', 'This quarter', 'Just researching']);
      var company = field(form, 'company', 'Company (optional)', 'text');
      company.maxLength = 160;
      var email = field(form, 'email', 'Work email', 'email', { required: true });
      email.autocomplete = 'email';
      var hp = el('input', 'rc-hp'); hp.name = 'website_url'; hp.tabIndex = -1; hp.autocomplete = 'off'; hp.setAttribute('aria-hidden', 'true');
      form.appendChild(hp);
      var consent = el('p', 'rc-c', offer.consent + ' ');
      var pl = el('a', null, 'Privacy'); pl.href = offer.privacy_url; pl.target = '_blank'; pl.rel = 'noopener';
      consent.appendChild(pl);
      form.appendChild(consent);
      var btn = el('button', 'rc-b', 'Get a quote from ' + offer.vendor.name); btn.type = 'submit';
      form.appendChild(btn);
      var msg = el('p', 'rc-m');
      form.appendChild(msg);
      box.appendChild(form);
      root.appendChild(box);
      var leadId = null;
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        btn.disabled = true; msg.textContent = '';
        if (leadId) {
          post('/api/v1/leads/' + leadId + '/verify', { code: form.querySelector('[name=code]').value })
            .then(function (r) { form.textContent = ''; form.appendChild(el('p', 'rc-ok', r.message || ('Sent to ' + offer.vendor.name + '.'))); })
            .catch(function (err) { msg.textContent = err.message; btn.disabled = false; });
          return;
        }
        post('/api/v1/leads', { token: offer.token, vendor_id: offer.vendor.id, niche: niche, need: need.value, budget: budget.value, timeline: timeline.value, company: company.value, email: email.value, page_url: location.href, website_url: hp.value, signals: sig })
          .then(function (r) {
            leadId = r.lead_id;
            Array.prototype.forEach.call(form.querySelectorAll('.rc-f'), function (f) { f.hidden = true; });
            var c = field(form, 'code', 'We emailed a 6-digit code to ' + email.value + '. Enter it to send your request:', 'text', { required: true });
            c.inputMode = 'numeric'; c.maxLength = 6; c.autocomplete = 'one-time-code';
            form.insertBefore(c.parentNode, consent);
            btn.textContent = 'Confirm'; btn.disabled = false; c.focus();
          })
          .catch(function (err) { msg.textContent = err.message; btn.disabled = false; });
      });
    }).catch(function () {});
  });
  }
  // Single-page apps call window.RealClicks.scan() after rendering a new form container.
  window.RealClicks = { scan: scan };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', scan);
  else scan();
})();
