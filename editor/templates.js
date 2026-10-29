/*
 * Starting points for new websites. Each template is a set of plain files
 * (HTML pages, one CSS file, a small script, placeholder images) that the
 * editor writes into a new folder. Colors and fonts are CSS variables at the
 * top of css/style.css, so the Design tab can change them later. The fonts
 * are the ones already on the visitor's computer: nothing is loaded from
 * other servers.
 */
(function () {
  'use strict';

  var PALETTES = [
    { id: 'teal', color: '#0f766e' },
    { id: 'blue', color: '#2563eb' },
    { id: 'indigo', color: '#4f46e5' },
    { id: 'rose', color: '#e11d48' },
    { id: 'amber', color: '#b45309' },
    { id: 'green', color: '#15803d' },
    { id: 'slate', color: '#334155' }
  ];

  var FONTS = [
    { id: 'modern', heading: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      body: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
    { id: 'classic', heading: 'Georgia, "Times New Roman", Times, serif',
      body: 'system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif' },
    { id: 'elegant', heading: '"Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif',
      body: '"Avenir Next", Avenir, "Segoe UI", system-ui, sans-serif' },
    { id: 'friendly', heading: 'ui-rounded, "Arial Rounded MT Bold", "Nunito", "Avenir Next", system-ui, sans-serif',
      body: 'ui-rounded, "Avenir Next", "Nunito", system-ui, sans-serif' }
  ];

  var TEMPLATES = ['business', 'personal', 'blank'];

  // ---------------------------------------------------------------- texts

  var TEXT = {
    de: {
      files: { services: 'leistungen.html', about: 'ueber-uns.html', contact: 'kontakt.html', imprint: 'impressum.html',
        privacy: 'datenschutz.html', placeholder: 'platzhalter.svg' },
      nav: { home: 'Start', services: 'Leistungen', about: 'Über uns', contact: 'Kontakt', imprint: 'Impressum',
        privacy: 'Datenschutz', aboutMe: 'Über mich', work: 'Arbeiten' },
      menu: 'Menü', mainMenu: 'Hauptmenü', legal: 'Rechtliches', pages: 'Seiten',
      welcome: 'Willkommen',
      heroLead: 'Schreiben Sie hier in zwei, drei Sätzen, was Sie anbieten und warum man zu Ihnen kommen sollte.',
      ctaPrimary: 'Termin vereinbaren', ctaSecondary: 'Unsere Leistungen',
      offerEyebrow: 'Was wir bieten', offerTitle: 'Unsere Leistungen auf einen Blick',
      offerLead: 'Ein kurzer Satz, der Ihre Leistungen zusammenfasst.',
      cards: [
        ['Beratung', 'Beschreiben Sie diese Leistung in ein, zwei Sätzen. Was hat Ihr Kunde davon?'],
        ['Umsetzung', 'Beschreiben Sie diese Leistung in ein, zwei Sätzen. Was hat Ihr Kunde davon?'],
        ['Betreuung', 'Beschreiben Sie diese Leistung in ein, zwei Sätzen. Was hat Ihr Kunde davon?'],
        ['Vorsorge', 'Beschreiben Sie diese Leistung in ein, zwei Sätzen. Was hat Ihr Kunde davon?'],
        ['Termine am Abend', 'Beschreiben Sie diese Leistung in ein, zwei Sätzen. Was hat Ihr Kunde davon?'],
        ['Hausbesuche', 'Beschreiben Sie diese Leistung in ein, zwei Sätzen. Was hat Ihr Kunde davon?']
      ],
      aboutEyebrow: 'Über uns', aboutTitle: 'Persönlich, erfahren und für Sie da',
      aboutText: 'Erzählen Sie hier, wer Sie sind, seit wann es Sie gibt und was Sie besonders macht. Kurze Absätze lesen sich am besten.',
      checks: ['Langjährige Erfahrung', 'Persönliche Betreuung', 'Kurze Wartezeiten'],
      aboutMore: 'Mehr über uns',
      quote: '„Hier steht die Meinung eines zufriedenen Kunden. Ein echtes Zitat schafft Vertrauen.“',
      quoteBy: 'Name, Ort',
      ctaTitle: 'Wir freuen uns auf Sie', ctaText: 'Rufen Sie an oder schreiben Sie uns, wir melden uns schnell.',
      ctaButton: 'Kontakt aufnehmen',
      servicesLead: 'Hier finden Sie alle Leistungen im Überblick. Fragen beantworten wir gern persönlich.',
      faqTitle: 'Häufige Fragen',
      faq: [
        ['Wie vereinbare ich einen Termin?', 'Rufen Sie uns an oder schreiben Sie eine E-Mail. Wir melden uns innerhalb eines Werktags.'],
        ['Was kostet eine Beratung?', 'Schreiben Sie hier die Antwort. Klare Antworten ersparen viele Anrufe.'],
        ['Wo kann ich parken?', 'Schreiben Sie hier die Antwort.']
      ],
      aboutLead: 'Lernen Sie uns kennen: wer wir sind und wie wir arbeiten.',
      storyTitle: 'Unsere Geschichte',
      storyText: 'Erzählen Sie hier Ihre Geschichte: Wie hat alles angefangen, was ist Ihnen wichtig, wohin geht die Reise?',
      teamTitle: 'Unser Team',
      team: [['Vorname Nachname', 'Inhaberin'], ['Vorname Nachname', 'Mitarbeiter'], ['Vorname Nachname', 'Mitarbeiterin']],
      contactLead: 'So erreichen Sie uns. Wir freuen uns auf Ihre Nachricht.',
      address: 'Adresse', addressLines: ['Musterstraße 1', '12345 Musterstadt'],
      phone: 'Telefon', phoneNumber: '030 123 456 78', email: 'E-Mail',
      hours: 'Öffnungszeiten',
      hoursRows: [['Mo – Do', '8 – 18 Uhr'], ['Fr', '8 – 14 Uhr'], ['Sa – So', 'geschlossen']],
      route: 'Anfahrt', routeText: 'Mit Bus und Bahn: Haltestelle Musterplatz, 3 Minuten zu Fuß.',
      routeLink: 'In Karten öffnen',
      imprintText: [
        ['Angaben gemäß § 5 DDG', 'Vorname Nachname<br>Firmenname<br>Musterstraße 1<br>12345 Musterstadt'],
        ['Kontakt', 'Telefon: 030 123 456 78<br>E-Mail: info@example.de'],
        ['Hinweis', 'Dies ist ein Muster. Bitte ergänzen Sie alle Pflichtangaben für Ihr Unternehmen und lassen Sie sie im Zweifel prüfen.']
      ],
      privacyText: [
        ['Datenschutz auf einen Blick', 'Diese Website setzt keine Cookies und lädt keine Inhalte von anderen Servern. Beschreiben Sie hier, welche Daten Sie verarbeiten, zum Beispiel wenn Kunden Ihnen E-Mails schreiben.'],
        ['Verantwortlich', 'Vorname Nachname, Musterstraße 1, 12345 Musterstadt, info@example.de'],
        ['Hinweis', 'Dies ist ein Muster. Bitte passen Sie die Datenschutzerklärung an Ihre Website an und lassen Sie sie im Zweifel prüfen.']
      ],
      footerText: 'Ein Satz über Sie, zum Beispiel Ihr Motto oder was Sie anbieten.',
      rights: 'Alle Rechte vorbehalten.',
      hello: 'Hallo, ich bin', personalLead: 'Fotografin, Gestalterin, Musikerin? Schreiben Sie hier in einem Satz, was Sie machen.',
      seeWork: 'Meine Arbeiten', writeMe: 'Schreib mir',
      aboutMeTitle: 'Über mich',
      aboutMeText: 'Erzählen Sie hier von sich: Was treibt Sie an, wie arbeiten Sie, was ist Ihnen wichtig?',
      workTitle: 'Ausgewählte Arbeiten', workLead: 'Tauschen Sie die Bilder gegen Ihre eigenen aus: Doppelklick auf ein Bild.',
      offerMe: 'Was ich anbiete',
      checksMe: ['Persönlich und zuverlässig', 'Mit Liebe zum Detail', 'Termine nach Absprache'],
      cardsMe: [['Projekt', 'Kurze Beschreibung, was Sie hier anbieten.'], ['Workshop', 'Kurze Beschreibung, was Sie hier anbieten.'],
        ['Auftrag', 'Kurze Beschreibung, was Sie hier anbieten.']],
      contactMe: 'Lust auf ein gemeinsames Projekt?', contactMeText: 'Schreiben Sie mir, ich antworte innerhalb von zwei Tagen.',
      blankTitle: 'Ihre neue Website', blankLead: 'Klicken Sie links auf „Einfügen“ und ziehen Sie Abschnitte auf die Seite. Doppelklick auf einen Text ändert ihn.',
      description: 'Website von {name}',
      imageAlt: 'Platzhalterbild',
      cardIcons: ['✦', '◆', '●', '★', '☾', '⌂']
    },
    en: {
      files: { services: 'services.html', about: 'about.html', contact: 'contact.html', imprint: 'imprint.html',
        privacy: 'privacy.html', placeholder: 'placeholder.svg' },
      nav: { home: 'Home', services: 'Services', about: 'About', contact: 'Contact', imprint: 'Imprint',
        privacy: 'Privacy', aboutMe: 'About me', work: 'Work' },
      menu: 'Menu', mainMenu: 'Main menu', legal: 'Legal', pages: 'Pages',
      welcome: 'Welcome',
      heroLead: 'Say here in two or three sentences what you offer and why people should come to you.',
      ctaPrimary: 'Book an appointment', ctaSecondary: 'Our services',
      offerEyebrow: 'What we offer', offerTitle: 'Our services at a glance',
      offerLead: 'One short sentence that sums up your services.',
      cards: [
        ['Advice', 'Describe this service in one or two sentences. What does your customer get?'],
        ['Delivery', 'Describe this service in one or two sentences. What does your customer get?'],
        ['Support', 'Describe this service in one or two sentences. What does your customer get?'],
        ['Check-ups', 'Describe this service in one or two sentences. What does your customer get?'],
        ['Evening hours', 'Describe this service in one or two sentences. What does your customer get?'],
        ['Home visits', 'Describe this service in one or two sentences. What does your customer get?']
      ],
      aboutEyebrow: 'About us', aboutTitle: 'Personal, experienced and here for you',
      aboutText: 'Tell people who you are, how long you have been around and what makes you special. Short paragraphs read best.',
      checks: ['Many years of experience', 'Personal care', 'Short waiting times'],
      aboutMore: 'More about us',
      quote: '“This is where a happy customer says what they think. A real quote builds trust.”',
      quoteBy: 'Name, town',
      ctaTitle: 'We look forward to hearing from you', ctaText: 'Call us or write to us, we answer quickly.',
      ctaButton: 'Get in touch',
      servicesLead: 'All our services at a glance. We are happy to answer your questions in person.',
      faqTitle: 'Frequently asked questions',
      faq: [
        ['How do I book an appointment?', 'Call us or send an email. We reply within one working day.'],
        ['What does a consultation cost?', 'Write the answer here. Clear answers save many phone calls.'],
        ['Where can I park?', 'Write the answer here.']
      ],
      aboutLead: 'Get to know us: who we are and how we work.',
      storyTitle: 'Our story',
      storyText: 'Tell your story here: how did it all start, what matters to you, where are you heading?',
      teamTitle: 'Our team',
      team: [['First Last', 'Owner'], ['First Last', 'Team member'], ['First Last', 'Team member']],
      contactLead: 'How to reach us. We look forward to your message.',
      address: 'Address', addressLines: ['1 Example Street', 'Example Town 12345'],
      phone: 'Phone', phoneNumber: '+1 555 123 4567', email: 'Email',
      hours: 'Opening hours',
      hoursRows: [['Mon – Thu', '8 am – 6 pm'], ['Fri', '8 am – 2 pm'], ['Sat – Sun', 'closed']],
      route: 'Directions', routeText: 'By bus or train: Example Square stop, a 3 minute walk.',
      routeLink: 'Open in maps',
      imprintText: [
        ['Company details', 'First Last<br>Company name<br>1 Example Street<br>Example Town 12345'],
        ['Contact', 'Phone: +1 555 123 4567<br>Email: info@example.com'],
        ['Note', 'This is a sample. Please add all the details the law requires for your business.']
      ],
      privacyText: [
        ['Privacy at a glance', 'This website sets no cookies and loads nothing from other servers. Describe here which data you process, for example when customers email you.'],
        ['Responsible', 'First Last, 1 Example Street, Example Town 12345, info@example.com'],
        ['Note', 'This is a sample. Please adapt the privacy policy to your website.']
      ],
      footerText: 'One sentence about you, for example your motto or what you offer.',
      rights: 'All rights reserved.',
      hello: 'Hi, I am', personalLead: 'Photographer, designer, musician? Say in one sentence what you do.',
      seeWork: 'See my work', writeMe: 'Write to me',
      aboutMeTitle: 'About me',
      aboutMeText: 'Tell people about yourself: what drives you, how you work, what matters to you?',
      workTitle: 'Selected work', workLead: 'Swap the pictures for your own: double-click a picture.',
      offerMe: 'What I offer',
      checksMe: ['Personal and reliable', 'With an eye for detail', 'Flexible appointments'],
      cardsMe: [['Projects', 'A short description of what you offer here.'], ['Workshops', 'A short description of what you offer here.'],
        ['Commissions', 'A short description of what you offer here.']],
      contactMe: 'Shall we work together?', contactMeText: 'Write to me, I answer within two days.',
      blankTitle: 'Your new website', blankLead: 'Click "Add" on the left and drag sections onto the page. Double-click any text to change it.',
      description: 'Website of {name}',
      imageAlt: 'Placeholder picture',
      cardIcons: ['✦', '◆', '●', '★', '☾', '⌂']
    }
  };

  // ---------------------------------------------------------------- colors

  function hexToRgb(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    var n = m ? parseInt(m[1], 16) : 0x2563eb;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function rgbToHex(rgb) {
    return '#' + rgb.map(function (v) { return ('0' + Math.round(v).toString(16)).slice(-2); }).join('');
  }

  function mix(hex, other, share) {
    var a = hexToRgb(hex), b = hexToRgb(other);
    return rgbToHex(a.map(function (v, i) { return v * share + b[i] * (1 - share); }));
  }

  function luminance(hex) {
    var c = hexToRgb(hex).map(function (v) {
      v /= 255;
      return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }

  /* The colors of a website made from one main color. */
  function colors(primary) {
    return {
      primary: primary,
      primaryText: luminance(primary) > 0.45 ? '#111827' : '#ffffff',
      text: mix(primary, '#111111', 0.12),
      muted: mix(primary, '#5b6170', 0.1),
      background: '#ffffff',
      surface: mix(primary, '#ffffff', 0.06),
      border: mix(primary, '#e6e8ec', 0.08),
      footer: mix(primary, '#0d1117', 0.18)
    };
  }

  // ---------------------------------------------------------------- files

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function css(o) {
    var c = colors(o.color);
    var font = FONTS.filter(function (f) { return f.id === o.font; })[0] || FONTS[0];
    return [
      '/* Colors and fonts of the website. The editor\'s Design tab changes them. */',
      ':root {',
      '  --color-primary: ' + c.primary + ';',
      '  --color-primary-text: ' + c.primaryText + ';',
      '  --color-text: ' + c.text + ';',
      '  --color-muted: ' + c.muted + ';',
      '  --color-background: ' + c.background + ';',
      '  --color-surface: ' + c.surface + ';',
      '  --color-border: ' + c.border + ';',
      '  --color-footer: ' + c.footer + ';',
      '  --font-heading: ' + font.heading + ';',
      '  --font-body: ' + font.body + ';',
      '  --radius: 14px;',
      '  --width: 1120px;',
      '}',
      '',
      '*, *::before, *::after { box-sizing: border-box; }',
      'html { scroll-behavior: smooth; scroll-padding-top: 90px; }',
      'body { margin: 0; font-family: var(--font-body); font-size: 1.0625rem; line-height: 1.65; color: var(--color-text); background: var(--color-background); -webkit-font-smoothing: antialiased; }',
      'img { max-width: 100%; height: auto; display: block; }',
      'a { color: var(--color-primary); }',
      'h1, h2, h3, h4 { font-family: var(--font-heading); line-height: 1.2; margin: 0 0 .6em; letter-spacing: -.01em; }',
      'h1 { font-size: clamp(2.1rem, 4.5vw, 3.4rem); }',
      'h2 { font-size: clamp(1.6rem, 3vw, 2.3rem); }',
      'h3 { font-size: 1.25rem; }',
      'p { margin: 0 0 1em; }',
      '.container { width: min(100% - 40px, var(--width)); margin-inline: auto; }',
      '.narrow { width: min(100% - 40px, 760px); margin-inline: auto; }',
      '',
      '/* Header and menu */',
      '.site-header { position: sticky; top: 0; z-index: 50; background: color-mix(in srgb, var(--color-background) 90%, transparent); backdrop-filter: saturate(1.6) blur(12px); -webkit-backdrop-filter: saturate(1.6) blur(12px); border-bottom: 1px solid var(--color-border); }',
      '.header-inner { display: flex; align-items: center; justify-content: space-between; gap: 24px; min-height: 72px; }',
      '.brand { display: inline-flex; align-items: center; gap: 10px; font-family: var(--font-heading); font-weight: 700; font-size: 1.2rem; color: var(--color-text); text-decoration: none; }',
      '.brand img { height: 40px; width: auto; }',
      '.brand-mark { width: 30px; height: 30px; border-radius: 9px; background: var(--color-primary); flex: none; }',
      '.nav ul { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 4px; }',
      '.nav a { display: block; padding: 8px 14px; border-radius: 999px; color: var(--color-text); text-decoration: none; font-weight: 500; }',
      '.nav a:hover { background: var(--color-surface); }',
      '.nav a[aria-current="page"] { color: var(--color-primary); background: color-mix(in srgb, var(--color-primary) 10%, transparent); }',
      '.nav-toggle { display: none; width: 44px; height: 44px; border: 1px solid var(--color-border); border-radius: 12px; background: var(--color-background); cursor: pointer; padding: 0; flex-direction: column; align-items: center; justify-content: center; gap: 5px; }',
      '.nav-toggle span { display: block; width: 20px; height: 2px; border-radius: 2px; background: var(--color-text); }',
      '@media (max-width: 760px) {',
      '  .nav-toggle { display: inline-flex; }',
      '  .nav { display: none; position: absolute; left: 0; right: 0; top: 100%; background: var(--color-background); border-bottom: 1px solid var(--color-border); padding: 12px 20px 20px; }',
      '  .nav.open { display: block; }',
      '  .nav ul { flex-direction: column; }',
      '}',
      '',
      '/* Buttons */',
      '.button { display: inline-flex; align-items: center; gap: 8px; padding: 13px 24px; border-radius: 999px; background: var(--color-primary); color: var(--color-primary-text); border: 2px solid var(--color-primary); font-weight: 600; text-decoration: none; transition: transform .15s, box-shadow .15s; }',
      '.button:hover { transform: translateY(-1px); box-shadow: 0 10px 24px -12px var(--color-primary); }',
      '.button.secondary { background: transparent; color: var(--color-primary); }',
      '.buttons { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 28px; }',
      '',
      '/* Sections */',
      '.section { padding: clamp(56px, 8vw, 104px) 0; }',
      '.section.alt { background: var(--color-surface); }',
      '.section:not(.alt) + .section:not(.alt) { padding-top: 0; }',
      '.section-head { max-width: 640px; margin-bottom: 40px; }',
      '.eyebrow { display: inline-block; font-size: .8rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--color-primary); margin-bottom: 12px; }',
      '.lead { font-size: 1.2rem; color: var(--color-muted); }',
      '.page-head { padding: clamp(48px, 7vw, 88px) 0 clamp(32px, 5vw, 56px); background: var(--color-surface); }',
      '.page-head h1 { margin-bottom: .3em; }',
      '.page-head p { max-width: 640px; }',
      '',
      '/* Large intro with picture */',
      '.hero { padding: clamp(56px, 9vw, 120px) 0; background: linear-gradient(180deg, var(--color-surface), var(--color-background)); }',
      '.hero-inner { display: grid; grid-template-columns: 1.1fr .9fr; gap: 56px; align-items: center; }',
      '.hero-image img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: calc(var(--radius) * 1.6); box-shadow: 0 30px 60px -30px rgba(0, 0, 0, .35); }',
      '',
      '/* Cards */',
      '.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 24px; }',
      '.card { background: var(--color-background); border: 1px solid var(--color-border); border-radius: var(--radius); padding: 28px; transition: box-shadow .2s, transform .2s; }',
      '.card:hover { box-shadow: 0 18px 40px -24px rgba(0, 0, 0, .3); transform: translateY(-2px); }',
      '.card p:last-child { margin-bottom: 0; }',
      '.card-icon { width: 48px; height: 48px; border-radius: 12px; display: grid; place-items: center; margin-bottom: 18px; background: color-mix(in srgb, var(--color-primary) 12%, transparent); color: var(--color-primary); font-size: 1.3rem; }',
      '',
      '/* Text next to a picture */',
      '.split { display: grid; grid-template-columns: 1fr 1fr; gap: 56px; align-items: center; }',
      '.split img { width: 100%; aspect-ratio: 4 / 3; object-fit: cover; border-radius: var(--radius); }',
      '.checklist { list-style: none; padding: 0; margin: 0 0 1em; }',
      '.checklist li { position: relative; padding-left: 34px; margin: 10px 0; }',
      '.checklist li::before { content: "\\2713"; position: absolute; left: 0; top: 2px; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: var(--color-primary); color: var(--color-primary-text); font-size: .75rem; font-weight: 700; }',
      '@media (max-width: 860px) { .hero-inner, .split { grid-template-columns: 1fr; gap: 36px; } }',
      '',
      '/* Team */',
      '.team { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 28px; }',
      '.person img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: var(--radius); margin-bottom: 16px; }',
      '.person h3 { margin-bottom: 2px; }',
      '.person p { color: var(--color-muted); }',
      '',
      '/* Quote */',
      '.quote { max-width: 760px; margin: 0 auto; text-align: center; }',
      '.quote blockquote { margin: 0; font-family: var(--font-heading); font-size: clamp(1.3rem, 2.4vw, 1.75rem); line-height: 1.45; }',
      '.quote p { margin-top: 18px; color: var(--color-muted); }',
      '',
      '/* Call to action */',
      '.cta { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 24px; padding: clamp(36px, 6vw, 64px); border-radius: calc(var(--radius) * 1.6); background: var(--color-primary); color: var(--color-primary-text); }',
      '.cta h2 { margin: 0; }',
      '.cta p { margin: 8px 0 0; opacity: .9; }',
      '.cta .button { background: var(--color-primary-text); color: var(--color-primary); border-color: var(--color-primary-text); }',
      '',
      '/* Contact */',
      '.contact { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 24px; }',
      '.hours { width: 100%; border-collapse: collapse; }',
      '.hours th, .hours td { padding: 10px 0; border-bottom: 1px solid var(--color-border); text-align: left; vertical-align: top; }',
      '.hours th { padding-right: 16px; font-weight: 600; }',
      '',
      '/* Pictures */',
      '.gallery { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 16px; }',
      '.gallery img { width: 100%; aspect-ratio: 1; object-fit: cover; border-radius: var(--radius); }',
      '',
      '/* Questions and answers (open without JavaScript) */',
      '.faq { max-width: 800px; }',
      '.faq details { margin-bottom: 12px; padding: 4px 22px; border: 1px solid var(--color-border); border-radius: var(--radius); background: var(--color-background); }',
      '.faq summary { display: flex; justify-content: space-between; gap: 16px; padding: 14px 0; list-style: none; cursor: pointer; font-weight: 600; }',
      '.faq summary::-webkit-details-marker { display: none; }',
      '.faq summary::after { content: "+"; color: var(--color-primary); font-size: 1.4rem; line-height: 1; }',
      '.faq details[open] summary::after { content: "\\2212"; }',
      '',
      '/* Text written straight into a page */',
      'main > :not(section) { width: min(100% - 40px, 760px); margin-inline: auto; }',
      'main > h1:first-child { margin-top: clamp(48px, 7vw, 88px); }',
      'main > :last-child:not(section) { margin-bottom: clamp(48px, 7vw, 88px); }',
      '.prose h2 { font-size: 1.35rem; margin-top: 1.6em; }',
      '',
      '/* Footer */',
      '.site-footer { padding: 56px 0 28px; background: var(--color-footer); color: #e5e7eb; }',
      '.site-footer a { color: inherit; text-decoration: none; opacity: .85; }',
      '.site-footer a:hover { opacity: 1; text-decoration: underline; }',
      '.site-footer .brand { color: #fff; }',
      '.site-footer h3 { font-size: .85rem; letter-spacing: .08em; text-transform: uppercase; opacity: .7; }',
      '.site-footer ul { list-style: none; margin: 0; padding: 0; }',
      '.site-footer li { margin: 6px 0; }',
      '.footer-grid { display: grid; grid-template-columns: 2fr 1fr 1fr; gap: 32px; }',
      '.footer-bottom { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 12px; margin-top: 40px; padding-top: 20px; border-top: 1px solid rgba(255, 255, 255, .12); font-size: .9rem; opacity: .7; }',
      '@media (max-width: 760px) { .footer-grid { grid-template-columns: 1fr; } }',
      ''
    ].join('\n');
  }

  var SCRIPT = [
    '// The menu button on small screens opens and closes the menu.',
    'document.querySelectorAll(\'.nav-toggle\').forEach(function (button) {',
    '  var nav = document.getElementById(button.getAttribute(\'aria-controls\'));',
    '  if (!nav) return;',
    '  button.addEventListener(\'click\', function () {',
    '    var open = nav.classList.toggle(\'open\');',
    '    button.setAttribute(\'aria-expanded\', String(open));',
    '  });',
    '});',
    ''
  ].join('\n');

  /* A soft picture with a sun and hills, to be replaced by real photos. */
  function placeholderSvg() {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 900" preserveAspectRatio="xMidYMid slice">\n' +
      '  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#e8edf3"/><stop offset="1" stop-color="#cfd8e3"/></linearGradient></defs>\n' +
      '  <rect width="1200" height="900" fill="url(#g)"/>\n' +
      '  <circle cx="830" cy="300" r="90" fill="#f8fafc" opacity=".9"/>\n' +
      '  <path d="M0 700 L300 430 L520 620 L720 470 L1200 820 L1200 900 L0 900 Z" fill="#b8c4d3"/>\n' +
      '  <path d="M0 780 L260 610 L480 760 L760 600 L1200 860 L1200 900 L0 900 Z" fill="#a3b1c2"/>\n' +
      '</svg>\n';
  }

  function faviconSvg(color, name) {
    var letter = esc((name || 'W').trim().charAt(0).toUpperCase() || 'W');
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="' + color + '"/>' +
      '<text x="32" y="43" font-family="system-ui, sans-serif" font-size="32" font-weight="700" text-anchor="middle" fill="' +
      colors(color).primaryText + '">' + letter + '</text></svg>\n';
  }

  // ---------------------------------------------------------------- pages

  /*
   * Build all files of a template.
   * options: { template, name, lang ('de'|'en'), color ('#rrggbb'), font (id) }
   * returns [{ path, content }]
   */
  function build(options) {
    var o = {
      template: TEMPLATES.indexOf(options.template) >= 0 ? options.template : 'business',
      name: (options.name || '').trim() || 'Website',
      lang: options.lang === 'en' ? 'en' : 'de',
      color: /^#[0-9a-f]{6}$/i.test(options.color || '') ? options.color.toLowerCase() : PALETTES[0].color,
      font: options.font || 'modern'
    };
    var T = TEXT[o.lang], F = T.files, name = esc(o.name);
    var img = 'images/' + F.placeholder;
    var year = new Date().getFullYear();

    var pages;
    if (o.template === 'personal') {
      pages = [
        { file: 'index.html', title: '', nav: 'home', body: personalHome() },
        { file: F.imprint, title: T.nav.imprint, nav: 'imprint', body: legal(T.nav.imprint, T.imprintText) },
        { file: F.privacy, title: T.nav.privacy, nav: 'privacy', body: legal(T.nav.privacy, T.privacyText) }
      ];
    } else if (o.template === 'blank') {
      pages = [
        { file: 'index.html', title: '', nav: 'home', body: blankHome() },
        { file: F.imprint, title: T.nav.imprint, nav: 'imprint', body: legal(T.nav.imprint, T.imprintText) },
        { file: F.privacy, title: T.nav.privacy, nav: 'privacy', body: legal(T.nav.privacy, T.privacyText) }
      ];
    } else {
      pages = [
        { file: 'index.html', title: '', nav: 'home', body: businessHome() },
        { file: F.services, title: T.nav.services, nav: 'services', body: servicesPage() },
        { file: F.about, title: T.nav.about, nav: 'about', body: aboutPage() },
        { file: F.contact, title: T.nav.contact, nav: 'contact', body: contactPage() },
        { file: F.imprint, title: T.nav.imprint, nav: 'imprint', body: legal(T.nav.imprint, T.imprintText) },
        { file: F.privacy, title: T.nav.privacy, nav: 'privacy', body: legal(T.nav.privacy, T.privacyText) }
      ];
    }

    function menuItems() {
      if (o.template === 'personal') {
        return [['index.html', T.nav.home], ['index.html#' + anchor(T.nav.aboutMe), T.nav.aboutMe],
          ['index.html#' + anchor(T.nav.work), T.nav.work], ['index.html#' + anchor(T.nav.contact), T.nav.contact]];
      }
      if (o.template === 'blank') return [['index.html', T.nav.home]];
      return [['index.html', T.nav.home], [F.services, T.nav.services], [F.about, T.nav.about], [F.contact, T.nav.contact]];
    }

    function header(file) {
      var items = menuItems().map(function (m) {
        return '          <li><a href="' + m[0] + '"' + (m[0] === file ? ' aria-current="page"' : '') + '>' + esc(m[1]) + '</a></li>';
      }).join('\n');
      return [
        '  <header class="site-header">',
        '    <div class="container header-inner">',
        '      <a class="brand" href="index.html"><span class="brand-mark"></span>' + name + '</a>',
        '      <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav" aria-label="' + T.menu + '"><span></span><span></span><span></span></button>',
        '      <nav id="nav" class="nav" aria-label="' + T.mainMenu + '">',
        '        <ul>',
        items,
        '        </ul>',
        '      </nav>',
        '    </div>',
        '  </header>'
      ].join('\n');
    }

    function footer(file) {
      var link = function (href, text) {
        return '            <li><a href="' + href + '"' + (href === file ? ' aria-current="page"' : '') + '>' + esc(text) + '</a></li>';
      };
      return [
        '  <footer class="site-footer">',
        '    <div class="container">',
        '      <div class="footer-grid">',
        '        <div>',
        '          <a class="brand" href="index.html"><span class="brand-mark"></span>' + name + '</a>',
        '          <p>' + T.footerText + '</p>',
        '        </div>',
        '        <div>',
        '          <h3>' + T.pages + '</h3>',
        '          <ul>',
        menuItems().map(function (m) { return link(m[0], m[1]); }).join('\n'),
        '          </ul>',
        '        </div>',
        '        <div>',
        '          <h3>' + T.legal + '</h3>',
        '          <ul>',
        link(F.imprint, T.nav.imprint),
        link(F.privacy, T.nav.privacy),
        '          </ul>',
        '        </div>',
        '      </div>',
        '      <div class="footer-bottom"><span>© ' + year + ' ' + name + '</span><span>' + T.rights + '</span></div>',
        '    </div>',
        '  </footer>'
      ].join('\n');
    }

    function page(p) {
      return [
        '<!doctype html>',
        '<html lang="' + o.lang + '">',
        '<head>',
        '  <meta charset="utf-8">',
        '  <meta name="viewport" content="width=device-width, initial-scale=1">',
        '  <title>' + (p.title ? esc(p.title) + ' – ' : '') + name + '</title>',
        '  <meta name="description" content="' + esc(T.description.replace('{name}', o.name)) + '">',
        '  <link rel="icon" href="images/favicon.svg">',
        '  <link rel="stylesheet" href="css/style.css">',
        '</head>',
        '<body>',
        '',
        header(p.file),
        '',
        '  <main>',
        p.body,
        '  </main>',
        '',
        footer(p.file),
        '',
        '  <script src="js/main.js"></script>',
        '</body>',
        '</html>',
        ''
      ].join('\n');
    }

    function image(alt, cls) {
      return '<img' + (cls ? ' class="' + cls + '"' : '') + ' src="' + img + '" alt="' + esc(alt || T.imageAlt) + '" width="1200" height="900">';
    }

    function cards(list, icons) {
      return list.map(function (c, i) {
        return [
          '          <div class="card">',
          icons ? '            <div class="card-icon">' + T.cardIcons[i % T.cardIcons.length] + '</div>' : null,
          '            <h3>' + esc(c[0]) + '</h3>',
          '            <p>' + esc(c[1]) + '</p>',
          '          </div>'
        ].filter(Boolean).join('\n');
      }).join('\n');
    }

    function pageHead(title, lead) {
      return [
        '    <section class="page-head">',
        '      <div class="container">',
        '        <h1>' + esc(title) + '</h1>',
        '        <p class="lead">' + esc(lead) + '</p>',
        '      </div>',
        '    </section>'
      ].join('\n');
    }

    function ctaBand(title, text, href, button) {
      return [
        '    <section class="section">',
        '      <div class="container">',
        '        <div class="cta">',
        '          <div>',
        '            <h2>' + esc(title) + '</h2>',
        '            <p>' + esc(text) + '</p>',
        '          </div>',
        '          <a class="button" href="' + href + '">' + esc(button) + '</a>',
        '        </div>',
        '      </div>',
        '    </section>'
      ].join('\n');
    }

    function businessHome() {
      return [
        '    <section class="hero">',
        '      <div class="container hero-inner">',
        '        <div>',
        '          <span class="eyebrow">' + T.welcome + '</span>',
        '          <h1>' + name + '</h1>',
        '          <p class="lead">' + T.heroLead + '</p>',
        '          <div class="buttons">',
        '            <a class="button" href="' + F.contact + '">' + T.ctaPrimary + '</a>',
        '            <a class="button secondary" href="' + F.services + '">' + T.ctaSecondary + '</a>',
        '          </div>',
        '        </div>',
        '        <div class="hero-image">' + image() + '</div>',
        '      </div>',
        '    </section>',
        '',
        '    <section class="section">',
        '      <div class="container">',
        '        <div class="section-head">',
        '          <span class="eyebrow">' + T.offerEyebrow + '</span>',
        '          <h2>' + T.offerTitle + '</h2>',
        '          <p class="lead">' + T.offerLead + '</p>',
        '        </div>',
        '        <div class="cards">',
        cards(T.cards.slice(0, 3), true),
        '        </div>',
        '      </div>',
        '    </section>',
        '',
        '    <section class="section alt">',
        '      <div class="container split">',
        '        <div>' + image() + '</div>',
        '        <div>',
        '          <span class="eyebrow">' + T.aboutEyebrow + '</span>',
        '          <h2>' + T.aboutTitle + '</h2>',
        '          <p>' + T.aboutText + '</p>',
        '          <ul class="checklist">',
        T.checks.map(function (c) { return '            <li>' + c + '</li>'; }).join('\n'),
        '          </ul>',
        '          <a class="button secondary" href="' + F.about + '">' + T.aboutMore + '</a>',
        '        </div>',
        '      </div>',
        '    </section>',
        '',
        '    <section class="section">',
        '      <div class="container quote">',
        '        <blockquote>' + T.quote + '</blockquote>',
        '        <p>' + T.quoteBy + '</p>',
        '      </div>',
        '    </section>',
        '',
        ctaBand(T.ctaTitle, T.ctaText, F.contact, T.ctaButton)
      ].join('\n');
    }

    function servicesPage() {
      return [
        pageHead(T.nav.services, T.servicesLead),
        '',
        '    <section class="section">',
        '      <div class="container">',
        '        <div class="cards">',
        cards(T.cards, true),
        '        </div>',
        '      </div>',
        '    </section>',
        '',
        '    <section class="section alt">',
        '      <div class="container faq">',
        '        <h2>' + T.faqTitle + '</h2>',
        T.faq.map(function (q, i) {
          return '        <details' + (i === 0 ? ' open' : '') + '>\n          <summary>' + esc(q[0]) + '</summary>\n          <p>' + esc(q[1]) + '</p>\n        </details>';
        }).join('\n'),
        '      </div>',
        '    </section>',
        '',
        ctaBand(T.ctaTitle, T.ctaText, F.contact, T.ctaButton)
      ].join('\n');
    }

    function aboutPage() {
      return [
        pageHead(T.nav.about, T.aboutLead),
        '',
        '    <section class="section">',
        '      <div class="container split">',
        '        <div>',
        '          <h2>' + T.storyTitle + '</h2>',
        '          <p>' + T.storyText + '</p>',
        '          <ul class="checklist">',
        T.checks.map(function (c) { return '            <li>' + c + '</li>'; }).join('\n'),
        '          </ul>',
        '        </div>',
        '        <div>' + image() + '</div>',
        '      </div>',
        '    </section>',
        '',
        '    <section class="section alt">',
        '      <div class="container">',
        '        <h2>' + T.teamTitle + '</h2>',
        '        <div class="team">',
        T.team.map(function (m) {
          return '          <div class="person">\n            ' + image(m[0]) + '\n            <h3>' + esc(m[0]) + '</h3>\n            <p>' + esc(m[1]) + '</p>\n          </div>';
        }).join('\n'),
        '        </div>',
        '      </div>',
        '    </section>'
      ].join('\n');
    }

    function contactPage() {
      var mail = o.lang === 'en' ? 'info@example.com' : 'info@example.de';
      return [
        pageHead(T.nav.contact, T.contactLead),
        '',
        '    <section class="section">',
        '      <div class="container contact">',
        '        <div class="card">',
        '          <h3>' + T.address + '</h3>',
        '          <p>' + name + '<br>' + T.addressLines.join('<br>') + '</p>',
        '          <p>' + T.phone + ': <a href="tel:' + T.phoneNumber.replace(/[^\d+]/g, '') + '">' + T.phoneNumber + '</a><br>' +
          T.email + ': <a href="mailto:' + mail + '">' + mail + '</a></p>',
        '        </div>',
        '        <div class="card">',
        '          <h3>' + T.hours + '</h3>',
        '          <table class="hours">',
        '            <tbody>',
        T.hoursRows.map(function (r) { return '              <tr><th>' + r[0] + '</th><td>' + r[1] + '</td></tr>'; }).join('\n'),
        '            </tbody>',
        '          </table>',
        '        </div>',
        '        <div class="card">',
        '          <h3>' + T.route + '</h3>',
        '          <p>' + T.routeText + '</p>',
        '          <a class="button secondary" href="https://www.openstreetmap.org/search?query=' +
          encodeURIComponent(T.addressLines.join(', ')).replace(/'/g, '%27') + '" target="_blank" rel="noopener">' + T.routeLink + '</a>',
        '        </div>',
        '      </div>',
        '    </section>'
      ].join('\n');
    }

    function legal(title, parts) {
      return [
        '    <section class="section">',
        '      <div class="narrow prose">',
        '        <h1>' + esc(title) + '</h1>',
        parts.map(function (p) { return '        <h2>' + esc(p[0]) + '</h2>\n        <p>' + p[1] + '</p>'; }).join('\n'),
        '      </div>',
        '    </section>'
      ].join('\n');
    }

    function personalHome() {
      var mail = o.lang === 'en' ? 'hello@example.com' : 'hallo@example.de';
      return [
        '    <section class="hero">',
        '      <div class="container hero-inner">',
        '        <div>',
        '          <span class="eyebrow">' + T.hello + '</span>',
        '          <h1>' + name + '</h1>',
        '          <p class="lead">' + T.personalLead + '</p>',
        '          <div class="buttons">',
        '            <a class="button" href="#' + anchor(T.nav.work) + '">' + T.seeWork + '</a>',
        '            <a class="button secondary" href="#' + anchor(T.nav.contact) + '">' + T.writeMe + '</a>',
        '          </div>',
        '        </div>',
        '        <div class="hero-image">' + image() + '</div>',
        '      </div>',
        '    </section>',
        '',
        '    <section class="section alt" id="' + anchor(T.nav.aboutMe) + '">',
        '      <div class="container split">',
        '        <div>' + image() + '</div>',
        '        <div>',
        '          <h2>' + T.aboutMeTitle + '</h2>',
        '          <p>' + T.aboutMeText + '</p>',
        '          <ul class="checklist">',
        T.checksMe.map(function (c) { return '            <li>' + c + '</li>'; }).join('\n'),
        '          </ul>',
        '        </div>',
        '      </div>',
        '    </section>',
        '',
        '    <section class="section" id="' + anchor(T.nav.work) + '">',
        '      <div class="container">',
        '        <div class="section-head">',
        '          <h2>' + T.workTitle + '</h2>',
        '          <p class="lead">' + T.workLead + '</p>',
        '        </div>',
        '        <div class="gallery">',
        [1, 2, 3, 4, 5, 6].map(function () { return '          ' + image(); }).join('\n'),
        '        </div>',
        '      </div>',
        '    </section>',
        '',
        '    <section class="section alt">',
        '      <div class="container">',
        '        <h2>' + T.offerMe + '</h2>',
        '        <div class="cards">',
        cards(T.cardsMe, true),
        '        </div>',
        '      </div>',
        '    </section>',
        '',
        '    <section class="section" id="' + anchor(T.nav.contact) + '">',
        '      <div class="container">',
        '        <div class="cta">',
        '          <div>',
        '            <h2>' + T.contactMe + '</h2>',
        '            <p>' + T.contactMeText + '</p>',
        '          </div>',
        '          <a class="button" href="mailto:' + mail + '">' + mail + '</a>',
        '        </div>',
        '      </div>',
        '    </section>'
      ].join('\n');
    }

    function blankHome() {
      return [
        '    <section class="hero">',
        '      <div class="container">',
        '        <h1>' + T.blankTitle + '</h1>',
        '        <p class="lead">' + T.blankLead + '</p>',
        '      </div>',
        '    </section>'
      ].join('\n');
    }

    var files = pages.map(function (p) { return { path: p.file, content: page(p) }; });
    files.push({ path: 'css/style.css', content: css(o) });
    files.push({ path: 'js/main.js', content: SCRIPT });
    files.push({ path: img, content: placeholderSvg() });
    files.push({ path: 'images/favicon.svg', content: faviconSvg(o.color, o.name) });
    return files;
  }

  function anchor(text) {
    return text.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  /*
   * The home page with its CSS and pictures put inline, for the live
   * preview while choosing a template (the files do not exist yet).
   */
  function preview(options) {
    var files = build(options);
    var byPath = {};
    files.forEach(function (f) { byPath[f.path] = f.content; });
    var html = byPath['index.html'];
    html = html.replace('<link rel="stylesheet" href="css/style.css">', '<style>' + byPath['css/style.css'] + '</style>');
    html = html.replace(/<script src="js\/main\.js"><\/script>/, '');
    html = html.replace(/(src|href)="(images\/[^"]+\.svg)"/g, function (m, attr, path) {
      return byPath[path] ? attr + '="data:image/svg+xml;charset=utf-8,' + encodeURIComponent(byPath[path]) + '"' : m;
    });
    // Links in the preview go nowhere.
    return html.replace('<head>', '<head><base target="_blank"><style>a{pointer-events:none}</style>');
  }

  window.WSETemplates = {
    PALETTES: PALETTES,
    FONTS: FONTS,
    TEMPLATES: TEMPLATES,
    build: build,
    preview: preview,
    placeholderSvg: placeholderSvg,
    placeholderName: function (lang) { return TEXT[lang === 'en' ? 'en' : 'de'].files.placeholder; },
    slug: anchor
  };
})();
