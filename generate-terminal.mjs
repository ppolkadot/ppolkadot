import fs from 'fs';

const USERNAME = 'ppolkadot';
const TOKEN = process.env.GH_TOKEN;
const DEFAULT_LANGS = 'Rust, JS, TypeScript';

async function fetchGitHubData() {
  if (!TOKEN) {
    console.warn('No GH_TOKEN provided, using fallback preview data.');
    return {
      streak: 14,
      total: 428,
      langs: DEFAULT_LANGS,
      commits: [
        '* 9c3b8f1 - init cyber-terminal workflow',
        '* f10a4e3 - add dark/light ascii globe',
        '* e38d27a - update profile dashboard'
      ]
    };
  }

  const query = `
    query($login: String!) {
      user(login: $login) {
        contributionsCollection {
          contributionCalendar {
            totalContributions
            weeks {
              contributionDays {
                contributionCount
                date
              }
            }
          }
        }
        repositories(first: 20, ownerAffiliations: OWNER, isFork: false, orderBy: {field: PUSHED_AT, direction: DESC}) {
          nodes {
            primaryLanguage {
              name
            }
          }
        }
      }
    }
  `;

  const gqlRes = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables: { login: USERNAME } }),
  });

  if (!gqlRes.ok) {
    throw new Error(`GraphQL request failed: ${gqlRes.status} ${gqlRes.statusText}`);
  }

  const gqlData = await gqlRes.json();
  if (gqlData.errors?.length || !gqlData.data?.user) {
    throw new Error(`GraphQL error: ${JSON.stringify(gqlData.errors ?? 'missing user data')}`);
  }

  const calendar = gqlData.data.user.contributionsCollection.contributionCalendar;
  const days = calendar.weeks.flatMap((w) => w.contributionDays).reverse();

  let streak = 0;
  for (let i = 0; i < days.length; i++) {
    if (days[i].contributionCount > 0) {
      streak++;
    } else if (i === 0) {
      continue;
    } else {
      break;
    }
  }

  const langCounts = new Map();
  for (const repo of gqlData.data.user.repositories?.nodes ?? []) {
    const name = repo?.primaryLanguage?.name;
    if (name) {
      langCounts.set(name, (langCounts.get(name) ?? 0) + 1);
    }
  }
  const topLangs = [...langCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([name]) => name);
  const langs = topLangs.length > 0 ? topLangs.join(', ') : DEFAULT_LANGS;

  const eventsRes = await fetch(`https://api.github.com/users/${USERNAME}/events/public?per_page=30`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

  if (!eventsRes.ok) {
    throw new Error(`Events request failed: ${eventsRes.status} ${eventsRes.statusText}`);
  }

  const events = await eventsRes.json();
  const commits = [];

  if (Array.isArray(events)) {
    for (const ev of events) {
      if (ev.repo?.name === `${USERNAME}/${USERNAME}`) continue;
      if (ev.type === 'PushEvent' && Array.isArray(ev.payload?.commits)) {
        for (const c of [...ev.payload.commits].reverse()) {
          if (c.author?.name === 'github-actions[bot]') continue;
          const sha = (c.sha ?? '0000000').substring(0, 7);
          const rawMsg = (c.message ?? '').split('\n')[0].replace(/[^\x20-\x7E]/g, '').trim();
          if (!rawMsg || rawMsg.startsWith('chore: update live terminal stats')) continue;
          const msg = rawMsg.length > 32 ? `${rawMsg.substring(0, 29)}...` : rawMsg;
          commits.push(`* ${sha} - ${msg}`);
          if (commits.length >= 3) break;
        }
      }
      if (commits.length >= 3) break;
    }
  }

  while (commits.length < 3) {
    commits.push('* 0000000 - awaiting next commit...');
  }

  return {
    streak,
    total: calendar.totalContributions,
    langs,
    commits,
  };
}

function escapeXml(unsafe) {
  return unsafe.replace(/[<>&'"]/g, (c) => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case "'": return '&apos;';
      case '"': return '&quot;';
    }
  });
}

function buildSvg(data, isDark = true) {
  const bg = isDark ? '#090d10' : '#f4f6f8';
  const border = isDark ? '#1a2b34' : '#d0d7de';
  const primary = isDark ? '#00ffcc' : '#007a60';
  const accent = isDark ? '#39ff14' : '#1a7f37';
  const text = isDark ? '#d8dee9' : '#24292f';
  const muted = isDark ? '#4c566a' : '#8c959f';

  const filledCount = data.streak === 0
    ? 0
    : Math.min(15, Math.ceil(((data.streak - 1) % 30 + 1) / 2));
  const barFilled = '█'.repeat(filledCount);
  const barEmpty = '░'.repeat(15 - filledCount);

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 480 340" width="480" height="340">
  <style>
    .term { font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Courier New', Courier, monospace; font-size: 13.5px; fill: ${text}; white-space: pre; }
    .header { fill: ${accent}; font-weight: bold; }
    .label { fill: ${primary}; font-weight: bold; }
    .bar-fill { fill: ${accent}; }
    .bar-empty { fill: ${muted}; }
    .cursor { fill: ${accent}; animation: blink 1s step-end infinite; }
    @keyframes blink { 50% { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) {
      .cursor { animation: none; }
    }
  </style>

  <rect width="480" height="340" rx="10" fill="${bg}" stroke="${border}" stroke-width="2"/>

  <g class="term">
    <text x="28" y="46" class="header">[${USERNAME} @ github]</text>
    <text x="28" y="64" fill="${muted}">--------------------------------------</text>
    <text x="28" y="90"><tspan class="label">OS:</tspan> Windows / WASAPI / BLE-Core</text>
    <text x="28" y="114"><tspan class="label">LANGS:</tspan> ${escapeXml(data.langs)}</text>
    <text x="28" y="138"><tspan class="label">COMMITS (1Y):</tspan> ${data.total} total</text>
    <text x="28" y="162"><tspan class="label">STREAK:</tspan> ${data.streak} days <tspan class="bar-fill">${barFilled}</tspan><tspan class="bar-empty">${barEmpty}</tspan></text>
    <text x="28" y="186"><tspan class="label">STATUS:</tspan> <tspan class="header">[ACTIVE]</tspan> 0x00A4 // streaming_ok</text>

    <text x="28" y="222" class="header">$ git log --oneline -3</text>
    <text x="28" y="244">${escapeXml(data.commits[0])}</text>
    <text x="28" y="266">${escapeXml(data.commits[1])}</text>
    <text x="28" y="288">${escapeXml(data.commits[2])}</text>

    <text x="28" y="318" class="header">$</text>
    <rect x="43" y="305" width="9" height="15" class="cursor" />
  </g>
</svg>`;
}

try {
  const data = await fetchGitHubData();
  fs.writeFileSync('terminal-dark.svg', buildSvg(data, true));
  fs.writeFileSync('terminal-light.svg', buildSvg(data, false));
  console.log('Generated terminal SVGs successfully:', data);
} catch (err) {
  console.error('Failed to update terminal SVGs:', err);
  process.exit(1);
}
