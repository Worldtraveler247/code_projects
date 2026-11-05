# Eddie's App Hub — `code_projects`

**Live site: [worldtraveler247.github.io/code_projects](https://worldtraveler247.github.io/code_projects/)**

A portfolio of small, self-contained web apps built by **Eddie Camacho** — Linux system administrator (RHCSA, CompTIA Security+) working in RHEL and Ansible automation. The hub collects the security tools, infrastructure trainers, and learning games I build to sharpen real skills: every app runs entirely in the browser, most are a handful of static files, and each one carries a **How It's Built** page that explains its design and code so anyone can replicate it.

## Projects

### Security
| App | What it does |
| --- | --- |
| [Linux Hardening (Ansible)](https://github.com/Worldtraveler247/linux-hardening-ansible) | Ansible playbooks for Linux security hardening — SSH, auditing, and more |
| [sshwatch](https://github.com/Worldtraveler247/sshwatch) | SSH brute-force detector and firewalld auto-responder for RHEL |
| [macOS Security Audit](https://github.com/Worldtraveler247/macos-hardening-audit) | Read-only macOS security audit — firewall, FileVault, SIP, Gatekeeper |
| [IAM Auditor](iam-auditor/) | Python tool that audits IAM-style policies for risky permissions |
| [JWT Decoder](jwt-decoder/) | Client-side JWT inspector that flags common token vulnerabilities |

### Tools
| App | What it does |
| --- | --- |
| [DevSecOps Job Hub](https://github.com/Worldtraveler247/devsecops-job-hub) | Finds cleared DevSecOps and cloud security roles at U.S. government contractors |
| [CIDR Calculator](cidr-calc/) | Subnet math in real time, with binary breakdown and a subnet splitter |
| [Career Ladder](career-ladder/) | A map of IT/security career rungs and what each one requires |
| [Dashboard](my-dashboard/) | Start-page widget: live clock, greeting, and GPS weather via Open-Meteo |
| [Real Estate Crash Indicator](real-estate-risk/) | 14 FRED indicators z-scored into a single 0–100 housing-risk gauge |
| [Stock Monitor](stock-monitor/) | One-file Streamlit app: SMA/RSI buy alerts on live Yahoo Finance data |

### Education
| App | What it does |
| --- | --- |
| [Subnet Trainer](subnet-trainer/) | Drills subnetting until the math is automatic |
| [Origin Trace](origin-trace/) | Traces how requests and data flow through systems |
| [AWS in Practice](aws-series/) | Hands-on explainers for core AWS services |
| [Cloud Security Languages](cloud-security-languages/) | The languages of cloud security work, side by side |
| [Glassbox](glassbox/) | See-through lessons that expose how systems work inside |
| [Ansible Facts Trainer](ansible-facts-trainer/) | Drills Ansible facts and magic variables |
| [Ansible Playbook Trainer](ansible-playbook-trainer/) | Practice writing playbooks task by task |
| [RHCE Syntax Trainer](rhce-syntax-trainer/) | Type-the-answer trainer for the EX294 exam — 39 chained tasks, vim-faithful editor |
| [Ansible Module Drill](ansible-module-drill/) | Rapid-fire drills on Ansible module syntax |
| [Ansible Command Recall](ansible-command-recall/) | Flashcard-style recall for ad hoc commands |
| [LOGHUNT](loghunt/) | Incident-response game: hunt an intrusion through RHEL logs |
| [Code Typist](code-typist/) | Touch-typing training on real Go, Python, and Bash snippets |
| [MathPath to AI](mathpath-to-ai/) | Free structured math curriculum — algebra to the math behind AI ([source repo](https://github.com/Worldtraveler247/mathpath-to-ai)) |

### Games
| App | What it does |
| --- | --- |
| [Async 3D Chess](3d-chess/) | Two-player 3D chess with Firebase sync — no need to be online together |
| [Galactic Runner](mario-style/) | Neon Canvas platformer with hand-rolled physics and parallax |
| [Tetris](my-tetris/) | Full Tetris clone: ghost piece, DAS/ARR handling, particles |
| [Galactic Guardian](space-shooter/) | Canvas space shooter with power-ups and boss fights |

### Portfolio
| App | What it does |
| --- | --- |
| [Digital Resume](https://worldtraveler247.github.io/resume/) | My resume as a website |
| [The Daily Brief](newsletter/) | My personal tech newsletter |

## How this repo works

- **Zero build step.** Every app is static HTML/CSS/JavaScript served by GitHub Pages straight from `main`. Open a folder, read its code — what you see is what runs.
- **One convention per app.** Each project folder holds its own `index.html` plus a `how-it-works.html` explainer, linked from its hub card.
- **Shared chrome.** The hub's `index.html`, `style.css`, and `app.js` provide the card grid, category filters, and search; `how-it-works.css` styles every explainer page.

## Run it locally

```bash
git clone https://github.com/Worldtraveler247/code_projects.git
cd code_projects
python3 -m http.server 8000
# open http://localhost:8000
```

## License

MIT — see [LICENSE](LICENSE). Build your own versions; that's what the How It's Built pages are for.
