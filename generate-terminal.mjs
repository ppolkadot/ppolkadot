import fs from 'fs';

const USERNAME = 'ppolkadot';
const TOKEN = process.env.GH_TOKEN;
const OS_LIST = 'Windows / Fedora Linux / MacOS';
const LANG_LIST = 'Rust, Java, TypeScript, Kotlin';

function formatCommitLine(sha, rawMessage) {
  const shortSha = (sha ?? '0000000').substring(0, 7);
  const cleanMsg = (rawMessage ?? '').split('\n')[0].replace(/[^\x20-\x7E]/g, '').trim();
  if (
    !cleanMsg ||
    cleanMsg.startsWith('chore: update live terminal stats') ||
    cleanMsg.startsWith('chore: tend the ')
  ) {
    return null;
  }
  const msg = cleanMsg.length > 32 ? `${cleanMsg.substring(0, 29)}...` : cleanMsg;
  return { sha: shortSha, line: `* ${shortSha} - ${msg}` };
}

async function fetchGitHubData() {
  if (!TOKEN) {
    console.warn('No GH_TOKEN provided, using fallback preview data.');
    return {
      streak: 14,
      total: 428,
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
        repositories(first: 6, ownerAffiliations: OWNER, privacy: PUBLIC, orderBy: {field: PUSHED_AT, direction: DESC}) {
          nodes {
            defaultBranchRef {
              target {
                ... on Commit {
                  history(first: 5) {
                    nodes {
                      oid
                      messageHeadline
                      committedDate
                      author {
                        name
                      }
                    }
                  }
                }
              }
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

  const seenShas = new Set();
  const commits = [];

  // Fetch recent public PushEvents; GitHub removed inline payload.commits, so resolve via head SHA
  const eventsRes = await fetch(`https://api.github.com/users/${USERNAME}/events/public?per_page=20`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

  if (eventsRes.ok) {
    const events = await eventsRes.json();
    if (Array.isArray(events)) {
      for (const ev of events) {
        if (ev.type !== 'PushEvent' || !ev.repo?.name) continue;
        if (Array.isArray(ev.payload?.commits)) {
          for (const c of [...ev.payload.commits].reverse()) {
            if (c.author?.name === 'github-actions[bot]') continue;
            const formatted = formatCommitLine(c.sha, c.message);
            if (formatted && !seenShas.has(formatted.sha)) {
              seenShas.add(formatted.sha);
              commits.push(formatted.line);
            }
            if (commits.length >= 3) break;
          }
        } else if (ev.payload?.head) {
          const commitRes = await fetch(
            `https://api.github.com/repos/${ev.repo.name}/commits?sha=${ev.payload.head}&per_page=5`,
            { headers: { Authorization: `Bearer ${TOKEN}` } }
          );
          if (commitRes.ok) {
            const repoCommits = await commitRes.json();
            if (Array.isArray(repoCommits)) {
              for (const c of repoCommits) {
                if (c.commit?.author?.name === 'github-actions[bot]' || c.author?.login === 'github-actions[bot]') {
                  continue;
                }
                const formatted = formatCommitLine(c.sha, c.commit?.message);
                if (formatted && !seenShas.has(formatted.sha)) {
                  seenShas.add(formatted.sha);
                  commits.push(formatted.line);
                }
                if (commits.length >= 3) break;
              }
            }
          }
        }
        if (commits.length >= 3) break;
      }
    }
  }

  // Fallback/supplement from public repo commit history sorted newest first
  if (commits.length < 3) {
    const repoCommits = (gqlData.data.user.repositories?.nodes ?? [])
      .flatMap((repo) => repo?.defaultBranchRef?.target?.history?.nodes ?? [])
      .filter((c) => c && c.author?.name !== 'github-actions[bot]')
      .sort((a, b) => new Date(b.committedDate) - new Date(a.committedDate));

    for (const c of repoCommits) {
      const formatted = formatCommitLine(c.oid, c.messageHeadline);
      if (formatted && !seenShas.has(formatted.sha)) {
        seenShas.add(formatted.sha);
        commits.push(formatted.line);
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
    <text x="28" y="64" fill="${muted}">------------------------------------------</text>
    <text x="28" y="90"><tspan class="label">OS:</tspan> ${escapeXml(OS_LIST)}</text>
    <text x="28" y="114"><tspan class="label">LANGS:</tspan> ${escapeXml(LANG_LIST)}</text>
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
