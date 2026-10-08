"""Builds one landing page per game type from the GAMES data below.

Run from the repo root:  python3 tools/build_game_pages.py
Edit the data here, not the generated *-game.html files, so all pages stay in step.
Prices and options must match order.html.
"""
import html, json

SITE = 'https://www.asherarcade.com'

COMMON_FAQ = [
    ('Who shows up on the leaderboard?',
     'Only the people you share your link with. Every game gets its own leaderboard, separate from every other game we '
     'build, so the names on it are your friends and family and nobody else. Players type a display name and the board '
     'updates live.'),
    ('How long does it take?',
     'Most games are ready within 7 days of getting your photos. Put the date you need it by on the order form and we '
     'will tell you right away if the timing is tight.'),
    ('How do I pay?',
     'You pay the game price through Stripe when you order. If you add extras, we confirm them with you and send a '
     'separate Stripe link for those, so your game is never held up.'),
    ('Do I get to see it first?',
     'Yes. We send you a preview link before it goes out so you can ask for fixes.'),
    ('How long does the game stay live?',
     'Hosting is free for the first 3 months, with your leaderboard saved the whole time. After that it is $19 a year to '
     'keep it live. If you do not renew, we retire the link.'),
    ('Do players need an app?',
     'No. It runs in the browser on any phone, tablet, or computer. Share the link or a QR code and people start playing.'),
]

GAMES = [
  {
    'file': 'drop-and-catch-game.html', 'key': 'drop-catch', 'price': 79, 'img': 'drop-catch',
    'name': 'Drop & Catch', 'kicker': 'Custom drop & catch game',
    'example': ('tinlee_game.html', "Tinlee's Pacifier Catch"),
    'title': 'Custom Drop & Catch Game with Your Photos | Asher Arcade',
    'desc': 'A custom catching game starring your kid, your pet, or the bride. Pick sports, pets, baby, or bouquets. '
            'Leaderboard just for your friends and family. $79.',
    'h1': 'Put your person in a catching game.',
    'sub': 'Your kid, your pet, or the bride catches the good stuff and dodges the bad stuff. Friends and family play from '
           'one link and fight for the top spot.',
    'includes': [
        'Your person or pet as the catcher, drawn from your photos',
        'One theme of falling items: sports, pets, baby, or bouquets',
        'Good items to catch and bad items to dodge, picked to fit your theme',
        'Your names on the title screen',
        'Gets faster the longer you last',
    ],
    'custom': [
        'Which of the four themes: sports, pets, baby, or bouquets',
        'What gets caught and what gets dodged within that theme',
        'The names and title on the game',
    ],
    'extras': [('Extra faces or characters', '$20 each'), ('A theme outside the four', '$40'),
               ('New levels, mechanics, or anything bigger', 'Quote')],
    'needs': [
        '3 clear, well-lit photos of the catcher, face visible, no sunglasses',
        'Which theme you want',
        'What they should catch and what they should dodge',
    ],
    'faq': [
        ('What themes can I pick?',
         'Sports, pets, baby, or bouquets. Bouquets works great for a bride, a maid of honor, or a bridal shower. Want '
         'something outside those four? That is a $40 theme upgrade.'),
        ('Can the catcher be a pet?',
         'Yes. Send 3 clear photos of the pet, and pets is one of the four themes if you want treats falling from the sky.'),
    ],
  },
  {
    'file': 'memory-match-game.html', 'key': 'memory-match', 'price': 79, 'img': 'memory-match',
    'name': 'Memory Match', 'kicker': 'Custom photo memory game',
    'example': ('match_game.html', 'Mullin & Burris Photo Match'),
    'title': 'Custom Photo Memory Match Game | Asher Arcade',
    'desc': 'A memory matching game built from your own photos. 6 photos for classic pairs or up to 12 matched by color. '
            'Leaderboard just for your family. $79.',
    'h1': 'Your photos, turned into a memory game.',
    'sub': 'Flip the cards, find the pairs, beat your cousin. Built from your own photos, with a leaderboard just for the '
           'family.',
    'includes': [
        'A 12-card board built from your photos',
        '6 photos: each one appears twice and you match the same picture',
        '7 to 12 photos: every card is a different photo and pairs match by color border',
        'Your names or title on the game',
        'Scored on speed and number of flips',
    ],
    'custom': [
        'Which photos go on the cards',
        'Classic same-photo pairs or color-matched pairs',
        'The names or title on the game',
    ],
    'extras': [('A different theme or card design', '$40'), ('A bigger board or more photos', 'Quote')],
    'needs': [
        '6 photos for a classic match, or up to 12 for color-matched pairs',
        'The names or title for the game',
    ],
    'faq': [
        ('How many photos should I send?',
         'The board has 12 cards. Send 6 photos and each one appears twice, so players match the same picture. Send 7 '
         'to 12 and every card is a different photo, and players match pairs by their color border.'),
    ],
  },
  {
    'file': 'whack-a-mole-game.html', 'key': 'whack-a-mole', 'price': 99, 'img': 'whack-a-mole',
    'name': 'Whack-a-Mole', 'kicker': 'Custom whack-a-mole game',
    'example': ('bonk_a_dragun.html', 'Bonk-a-Dragun'),
    'title': 'Custom Whack-a-Mole Game with Your Faces | Asher Arcade',
    'desc': 'Whack-a-[your name]: a custom whack-a-mole game with your logo and up to 4 faces popping up. Leaderboard '
            'just for your crew. $99.',
    'h1': 'Whack-a-[your name].',
    'sub': 'Up to four faces pop up and everybody gets a turn bonking them. Your own logo, your own people, and a '
           'leaderboard just for your crew.',
    'includes': [
        'A custom Whack-a-[your name] logo',
        'Up to 4 faces popping up, made from your photos',
        'Gets faster the longer you last',
    ],
    'custom': [
        'The name on the logo: Whack-a-Smith, Whack-a-Grandpa, Whack-a-Boss',
        'Which 4 faces pop up',
    ],
    'extras': [('More than 4 faces', '$20 each'), ('A different theme or backdrop', '$40'),
               ('Anything bigger', 'Quote')],
    'needs': [
        'The name for your logo',
        'Up to 4 clear photos of faces, one face per photo, looking at the camera',
    ],
    'faq': [
        ('Whose faces should I use?',
         'Anyone who can take a joke: the birthday person, the boss, the groomsmen, grandpa. One face per photo, looking '
         'at the camera, in good light works best.'),
    ],
  },
  {
    'file': 'endless-runner-game.html', 'key': 'endless-runner', 'price': 129, 'img': 'endless-runner',
    'name': 'Endless Runner', 'kicker': 'Custom endless skating game',
    'example': ('mags_game.html', "Mag's Endless Skate"),
    'title': 'Custom Endless Skating Game Starring Your Person | Asher Arcade',
    'desc': 'An endless skating game starring your person. Dodge obstacles, chase a high score, and compete on a '
            'leaderboard just for your friends and family. $129.',
    'h1': 'Your person, on a skateboard, forever.',
    'sub': 'An endless skating game starring your person. Dodge the obstacles, chase the high score, and see who in the '
           'family lasts the longest.',
    'includes': [
        'Your person as the skater, drawn from your photos',
        'Endless skating with obstacles that keep speeding up',
        'Their name on the game',
    ],
    'custom': [
        'Who the skater is',
        'The name on the game',
    ],
    'note': 'The Endless Runner is skating only for now.',
    'extras': [('Extra faces or characters', '$20 each'), ('Anything bigger', 'Quote')],
    'needs': [
        'Up to 3 clear photos of the skater, face and full body if you have one',
        'Their name as it should appear in the game',
    ],
    'faq': [
        ('Can it be biking or surfing instead?',
         'Not right now. The Endless Runner is a skating game, and that is the only version we sell at the moment.'),
    ],
  },
  {
    'file': 'wedding-platformer-game.html', 'key': 'platformer', 'price': 129, 'img': 'wedding-platformer',
    'name': 'Wedding Platformer', 'kicker': 'Custom wedding game',
    'example': ('bragg_game.html', 'Bragg Racing'),
    'title': 'Custom Wedding Platformer Game: Race to the Altar | Asher Arcade',
    'desc': 'Play as the bride or the groom and race to the altar. A custom wedding game with your faces and a '
            'leaderboard just for your guests. $129.',
    'h1': 'Race to the altar.',
    'sub': 'Play as the bride or the groom and dash through obstacles to reach the altar before the clock runs out. '
           'Guests play from one link and compete on your own wedding leaderboard.',
    'includes': [
        'The bride and groom as playable characters, drawn from your photos',
        'Players pick who to play: bride or groom',
        'A timed race through obstacles to the altar',
        'Your names on the title screen',
    ],
    'custom': [
        "The couple's names",
        'What the bride and groom look like',
    ],
    'extras': [('Extra faces or characters, like the wedding party', '$20 each'),
               ('A different setting or theme', '$40'), ('Anything bigger', 'Quote')],
    'needs': [
        'Names of the bride and groom',
        '1 to 2 good photos of each face',
    ],
    'faq': [
        ('When should we share it?',
         'Anytime: in the save-the-date email, on a QR sign at the reception, or after the wedding as a thank-you. The '
         'link and leaderboard stay live for 3 months free.'),
    ],
  },
]

ALL_LINKS = [(g['file'], g['name']) for g in GAMES] + [('reveal_announce.html', 'Reveal & Announce Puzzle')]

CSS = r"""
:root{--paper:#F6F0E4;--paper-2:#EDE4D1;--paper-3:#E4D9C1;--ink:#241F1A;--ink-soft:#6B6255;--navy:#0A1A32;
--amber:#E8A038;--ochre:#C2761B;--ochre-deep:#9E5C0E;--blue:#44679D;--blue-deep:#33507D;--rule:#CFC3A8;
--display:"Rubik Mono One","Arial Black",system-ui,sans-serif;--text:"Rubik","Helvetica Neue",Arial,system-ui,sans-serif;}
*{box-sizing:border-box;}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--text);font-size:17px;line-height:1.6;-webkit-font-smoothing:antialiased;}
img{max-width:100%;}
a{color:var(--blue-deep);}
:focus-visible{outline:3px solid var(--blue);outline-offset:3px;}
.wrap{max-width:1120px;margin:0 auto;padding:0 28px;}
.kicker{font-size:12px;font-weight:600;letter-spacing:.18em;text-transform:uppercase;color:var(--blue-deep);margin:0;}
h2{font-family:var(--display);font-size:clamp(23px,3.2vw,34px);line-height:1.1;margin:8px 0 22px;}
.topbar{position:sticky;top:0;z-index:50;background:rgba(246,240,228,.94);backdrop-filter:blur(8px);border-bottom:1px solid var(--rule);}
.topbar-in{max-width:1120px;margin:0 auto;padding:13px 28px 16px;display:flex;align-items:center;gap:26px;}
.brand{display:flex;align-items:center;gap:10px;text-decoration:none;color:var(--ink);}
.brand img{width:46px;height:46px;display:block;box-shadow:4px 4px 0 var(--ochre);}
.brand span{font-family:var(--display);font-size:19px;}
.topbar nav{margin-left:auto;display:flex;gap:22px;}
.topbar nav a{font-size:14px;font-weight:500;color:var(--ink-soft);text-decoration:none;}
.topbar nav a:hover{color:var(--ink);}
.topbar .cta{background:var(--ink);color:var(--paper);text-decoration:none;font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;padding:11px 16px;box-shadow:4px 4px 0 var(--ochre);}
.btn{display:inline-block;padding:15px 22px;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;background:var(--ink);color:var(--paper);box-shadow:5px 5px 0 var(--ochre);}
.btn:hover{box-shadow:2px 2px 0 var(--ochre);}
.btn-ghost{display:inline-block;padding:13px 20px;text-decoration:none;font-size:14px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--ink);border:2px solid var(--ink);}
.hero{padding:56px 0 60px;}
.hero-grid{display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:center;}
.hero h1{font-family:var(--display);font-size:clamp(30px,4.6vw,52px);line-height:1.04;margin:12px 0 0;}
.hero .sub{color:var(--ink-soft);font-size:18px;margin:18px 0 0;max-width:46ch;}
.price-line{margin:24px 0 0;font-size:15px;color:var(--ink-soft);}
.price-line b{font-family:var(--display);font-size:34px;color:var(--ink);margin-right:8px;vertical-align:-4px;}
.hero-btns{display:flex;flex-wrap:wrap;gap:14px;margin-top:24px;align-items:center;}
.shot{border:2px solid var(--ink);box-shadow:8px 8px 0 var(--ochre);background:var(--ink);aspect-ratio:16/10;overflow:hidden;}
.shot img{display:block;width:100%;height:100%;object-fit:cover;}
.lb{background:var(--navy);color:var(--paper);padding:52px 0 56px;}
.lb .kicker{color:var(--amber);}
.lb-grid{display:grid;grid-template-columns:1fr 1fr;gap:44px;align-items:start;}
.lb p.big{font-size:19px;color:#E9E1D2;margin:0;max-width:44ch;}
.lb ul{list-style:none;margin:0;padding:0;display:grid;gap:14px;}
.lb li{padding-left:22px;position:relative;color:#D6CDBC;}
.lb li::before{content:"";position:absolute;left:0;top:.55em;width:10px;height:10px;background:var(--amber);}
.lb li b{color:var(--paper);}
.sec{padding:58px 0 10px;}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:28px;align-items:start;}
.card{border:2px solid var(--ink);background:var(--paper);padding:24px 22px 26px;}
.card h3{font-family:var(--display);font-size:17px;margin:0 0 14px;}
.card ul{list-style:none;margin:0;padding:0;display:grid;gap:10px;}
.card li{padding-left:18px;position:relative;color:var(--ink-soft);font-size:15.5px;}
.card li::before{content:"";position:absolute;left:0;top:.6em;width:8px;height:8px;background:var(--ochre);}
.note{margin:14px 0 0;font-size:14.5px;font-weight:600;color:var(--ochre-deep);}
table.extras{width:100%;border-collapse:collapse;margin-top:4px;}
table.extras td{padding:11px 0;border-bottom:1px solid var(--rule);font-size:15.5px;vertical-align:top;}
table.extras td:last-child{text-align:right;font-weight:600;white-space:nowrap;padding-left:16px;}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:26px;}
.step{border-top:2px solid var(--ink);padding-top:16px;}
.step b{font-family:var(--display);font-size:26px;color:var(--ochre-deep);display:block;line-height:1;}
.step h3{font-family:var(--display);font-size:15px;margin:12px 0 0;}
.step p{margin:8px 0 0;color:var(--ink-soft);font-size:15.5px;}
.qa{border-top:1px solid var(--rule);}
.qa:last-child{border-bottom:1px solid var(--rule);}
.qa summary{cursor:pointer;list-style:none;padding:16px 0;display:flex;justify-content:space-between;gap:20px;font-weight:600;}
.qa summary::-webkit-details-marker{display:none;}
.qa summary::after{content:"+";font-family:var(--display);color:var(--blue-deep);}
.qa[open] summary::after{content:"\2013";}
.qa p{margin:0 0 18px;color:var(--ink-soft);max-width:72ch;}
.final{margin:60px 0 0;background:var(--paper-2);border-top:1px solid var(--paper-3);padding:52px 0 56px;text-align:center;}
.final h2{margin-bottom:10px;}
.final p{color:var(--ink-soft);margin:0 auto 24px;max-width:52ch;}
.others{margin-top:22px;font-size:14.5px;color:var(--ink-soft);}
.others a{margin:0 6px;}
.foot{border-top:2px solid var(--ink);padding:30px 0 42px;}
.foot-in{display:flex;flex-wrap:wrap;gap:18px;align-items:center;justify-content:space-between;}
.foot-brand{display:flex;align-items:center;gap:11px;}
.foot-brand img{width:38px;height:38px;box-shadow:3px 3px 0 var(--ochre);}
.foot small{font-size:13px;color:var(--ink-soft);}
.foot small a{color:inherit;}
.foot-nav{display:flex;flex-wrap:wrap;gap:18px;}
.foot-nav a{font-size:13.5px;color:var(--ink-soft);text-decoration:none;}
@media (max-width:900px){
  .hero-grid,.lb-grid,.cols{grid-template-columns:1fr;gap:28px;}
  .shot{order:-1;}
  .steps{grid-template-columns:1fr;}
  .topbar nav{display:none;}
}
@media (max-width:600px){ .wrap{padding:0 16px;} .topbar-in{padding:12px 16px 14px;} .brand span{font-size:15px;} .topbar .cta{padding:9px 11px;font-size:12px;} }
"""

def e(s):
    return html.escape(s, quote=True)

def li(items):
    return ''.join(f'<li>{e(i)}</li>' for i in items)

def page(g):
    url = f"{SITE}/{g['file']}"
    order = f"order.html?product={g['key']}"
    social = f"{SITE}/graphics/games/{g['img']}-social.jpg"
    faq = g['faq'] + COMMON_FAQ
    schema_product = {
        '@context': 'https://schema.org', '@type': 'Product', 'name': f"Custom {g['name']} Game",
        'description': g['desc'], 'image': social,
        'brand': {'@type': 'Brand', 'name': 'Asher Arcade'},
        'offers': {'@type': 'Offer', 'price': str(g['price']), 'priceCurrency': 'USD',
                   'availability': 'https://schema.org/InStock', 'url': url,
                   'seller': {'@type': 'LocalBusiness', '@id': f'{SITE}/#business', 'name': 'Asher Arcade'}},
    }
    schema_faq = {'@context': 'https://schema.org', '@type': 'FAQPage',
                  'mainEntity': [{'@type': 'Question', 'name': q,
                                  'acceptedAnswer': {'@type': 'Answer', 'text': a}} for q, a in faq]}
    extras_rows = ''.join(f'<tr><td>{e(a)}</td><td>{e(b)}</td></tr>' for a, b in g['extras'])
    note = f'<p class="note">{e(g["note"])}</p>' if g.get('note') else ''
    faq_html = ''.join(f'<details class="qa"><summary>{e(q)}</summary><p>{e(a)}</p></details>' for q, a in faq)
    others = ' &middot; '.join(f'<a href="{f}">{e(n)}</a>' for f, n in ALL_LINKS if f != g['file'])
    ex_file, ex_name = g['example']
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>{e(g['title'])}</title>
<meta name="description" content="{e(g['desc'])}">
<link rel="canonical" href="{url}">
<link rel="icon" href="logo-mark.png">
<meta property="og:type" content="product">
<meta property="og:url" content="{url}">
<meta property="og:title" content="{e(g['title'])}">
<meta property="og:description" content="{e(g['desc'])}">
<meta property="og:image" content="{social}">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:site_name" content="Asher Arcade">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{e(g['title'])}">
<meta name="twitter:description" content="{e(g['desc'])}">
<meta name="twitter:image" content="{social}">
<script type="application/ld+json">
{json.dumps(schema_product, indent=2)}
</script>
<script type="application/ld+json">
{json.dumps(schema_faq, indent=2)}
</script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Rubik+Mono+One&amp;family=Rubik:wght@300;400;500;600;700&amp;display=swap" rel="stylesheet">
<style>{CSS}</style>
<script async src="https://www.googletagmanager.com/gtag/js?id=G-CWKRCXYXTG"></script>
<script>
  window.dataLayer = window.dataLayer || [];
  function gtag(){{dataLayer.push(arguments);}}
  gtag('js', new Date());
  gtag('config', 'G-CWKRCXYXTG');
</script>
</head>
<body>
<!-- Generated by tools/build_game_pages.py. Edit the data there, then rerun it. -->
<header class="topbar">
  <div class="topbar-in">
    <a class="brand" href="index.html"><img src="logo-mark.png" width="192" height="192" alt="Asher Arcade"><span>ASHER ARCADE</span></a>
    <nav>
      <a href="arcade.html">Arcade</a>
      <a href="index.html#pricing">Pricing</a>
      <a href="#faq">FAQ</a>
    </nav>
    <a class="cta" href="{order}">Make this one mine</a>
  </div>
</header>

<section class="hero">
  <div class="wrap hero-grid">
    <div>
      <p class="kicker">{e(g['kicker'])}</p>
      <h1>{e(g['h1'])}</h1>
      <p class="sub">{e(g['sub'])}</p>
      <p class="price-line"><b>${g['price']}</b>one time &middot; free hosting for 3 months</p>
      <div class="hero-btns">
        <a class="btn" href="{order}">Make this one mine</a>
        <a class="btn-ghost" href="{ex_file}" target="_blank" rel="noopener">Play the example</a>
      </div>
    </div>
    <div class="shot"><img src="graphics/games/{g['img']}.jpg" alt="{e(ex_name)}, a custom {e(g['name'].lower())} game built by Asher Arcade" width="560" height="350"></div>
  </div>
</section>

<section class="lb">
  <div class="wrap lb-grid">
    <div>
      <p class="kicker">Leaderboard</p>
      <h2>A leaderboard just for your people.</h2>
      <p class="big">Every game we build gets its own leaderboard. The only names on it are the people you share your link with, so your friends and family are competing with each other, not with strangers.</p>
    </div>
    <ul>
      <li><b>Private to your link.</b> Nobody else's scores, ever.</li>
      <li><b>Live.</b> Players type a display name and the board updates the moment they finish.</li>
      <li><b>No setup.</b> Nothing for you to install or manage.</li>
      <li><b>Saved.</b> Scores stay up for the 3 months of free hosting, and as long as you renew at $19 a year.</li>
    </ul>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <p class="kicker">The standard build</p>
    <h2>What you get for ${g['price']}</h2>
    <div class="cols">
      <div class="card">
        <h3>Included</h3>
        <ul>{li(g['includes'] + ['A leaderboard just for your friends and family', 'Works on any phone, tablet, or computer, with no app', 'Free hosting for 3 months, then $19 a year'])}</ul>
      </div>
      <div class="card">
        <h3>What we need from you</h3>
        <ul>{li(g['needs'] + ['The date you need it by'])}</ul>
        <p class="note" style="color:var(--ink-soft);font-weight:500;">You upload the photos right on the order form.</p>
      </div>
    </div>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <p class="kicker">Customizing</p>
    <h2>What you can change</h2>
    <div class="cols">
      <div class="card">
        <h3>Included in the price</h3>
        <ul>{li(g['custom'])}</ul>
        {note}
      </div>
      <div class="card">
        <h3>Extras</h3>
        <table class="extras">{extras_rows}</table>
        <p class="note" style="color:var(--ink-soft);font-weight:500;">Pick extras on the order form. We confirm them and send a separate Stripe link, so your game is not held up.</p>
      </div>
    </div>
  </div>
</section>

<section class="sec">
  <div class="wrap">
    <p class="kicker">How it works</p>
    <h2>Three steps</h2>
    <div class="steps">
      <div class="step"><b>1</b><h3>Order and upload</h3><p>Fill out the order form, upload your photos, and pay ${g['price']} through Stripe.</p></div>
      <div class="step"><b>2</b><h3>We build it</h3><p>Most games are ready within 7 days. You get a preview link to check it first.</p></div>
      <div class="step"><b>3</b><h3>Share the link</h3><p>Send the link or a QR code. Your people play on their phones and fight for the top of the leaderboard.</p></div>
    </div>
  </div>
</section>

<section class="sec" id="faq">
  <div class="wrap">
    <p class="kicker">FAQ</p>
    <h2>Questions</h2>
    {faq_html}
  </div>
</section>

<section class="final">
  <div class="wrap">
    <h2>Make this one yours.</h2>
    <p>${g['price']} for the standard build, free hosting for 3 months, and a leaderboard just for your people.</p>
    <a class="btn" href="{order}">Make this one mine</a>
    <p class="others">Other games: {others}</p>
  </div>
</section>

<footer class="foot">
  <div class="wrap foot-in">
    <div class="foot-brand"><img src="logo-mark.png" width="192" height="192" alt="Asher Arcade"><small>&copy; 2026 Asher Arcade &middot; a Scott Asher LLC business &middot; <a href="policies.html">Policies</a></small></div>
    <div class="foot-nav"><a href="index.html">Home</a><a href="index.html#pricing">Pricing</a><a href="arcade.html">Arcade</a><a href="index.html#contact">Contact</a></div>
  </div>
</footer>
</body>
</html>
"""

if __name__ == '__main__':
    for g in GAMES:
        with open(g['file'], 'w', encoding='utf-8') as f:
            f.write(page(g))
        print('wrote', g['file'])
