# Commit metadata and pseudonymity

A commit records the author's name, an email address, and a time zone offset. On a public repository
anyone can read them. Adding `.patch` to a commit URL shows them without signing in.

This repository starts from one commit made with a GitHub noreply address. Keep it that way.

## What to set before your first commit

```bash
git config user.name "<your GitHub username>"
git config user.email "<id>+<username>@users.noreply.github.com"
```

Set that in each clone, or set it globally if every public repository should use it. GitHub shows
your noreply address under Settings, Emails. On the same page, turn on "Keep my email addresses
private" and "Block command line pushes that expose my email". The second setting makes GitHub
refuse a push that contains a commit authored with one of your private addresses.

Commit dates carry your local UTC offset. Run git with `TZ=UTC` if you do not want that recorded.

## If a personal address is pushed anyway

Removing it afterwards means rewriting every commit from the first affected one and force-pushing.
Open pull requests, forks, and existing clones have to reset. GitHub keeps the old commits reachable
through pull requests until support removes them, and a fork can keep them indefinitely. Fix the
identity before the push.

## Generated files

Do not commit test reports, lint reports, coverage output, or editor debug logs. They contain
absolute paths, and an absolute path contains your local username. `.gitignore` excludes the ones
this project produces.
