set positional-arguments

# Print the current package version.
version:
    @bun -e 'console.log((await Bun.file("package.json").json()).version)'

# Run the test suite.
check:
    bun test tests

# Bump the major version, then commit, tag, push, and publish a release.
bump-major:
    @just bump major

# Bump the minor version, then commit, tag, push, and publish a release.
bump-minor:
    @just bump minor

# Bump the patch version, then commit, tag, push, and publish a release.
bump-patch:
    @just bump patch

# Bump one version component, then commit, tag, push, and publish a release.
bump level:
    #!/usr/bin/env bash
    set -euo pipefail

    level="$1"
    case "$level" in
        major|minor|patch) ;;
        *) echo "usage: just bump major|minor|patch" >&2; exit 2 ;;
    esac

    if [[ "$(git rev-parse --abbrev-ref HEAD)" != "main" ]]; then
        echo "release bumps run on main only" >&2
        exit 1
    fi
    if [[ -n "$(git status --porcelain)" ]]; then
        echo "working tree is not clean; commit or stash first" >&2
        exit 1
    fi
    command -v gh >/dev/null || { echo "gh is required to publish the release" >&2; exit 1; }

    current=$(bun -e 'console.log((await Bun.file("package.json").json()).version)')
    IFS=. read -r major minor patch <<<"$current"
    if ! [[ "$major" =~ ^[0-9]+$ && "$minor" =~ ^[0-9]+$ && "$patch" =~ ^[0-9]+$ ]]; then
        echo "unsupported version: $current (expected MAJOR.MINOR.PATCH)" >&2
        exit 1
    fi
    case "$level" in
        major) major=$((major + 1)); minor=0; patch=0 ;;
        minor) minor=$((minor + 1)); patch=0 ;;
        patch) patch=$((patch + 1)) ;;
    esac
    next="$major.$minor.$patch"
    tag="v$next"

    if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
        echo "tag $tag already exists" >&2
        exit 1
    fi

    just check

    NEXT_VERSION="$next" bun -e 'const p="package.json"; const text=await Bun.file(p).text(); const updated=text.replace(/^(\s*"version"\s*:\s*")[^"]+(")/m, `$1${process.env.NEXT_VERSION}$2`); if (updated === text) throw new Error("version field not found"); await Bun.write(p, updated)'

    git add package.json
    git commit -m "chore(release): bump version to $next"
    git tag -a "$tag" -m "Release $next"
    git push origin HEAD
    git push origin "$tag"
    just release

# Publish a GitHub release for the latest tag.
release:
    #!/usr/bin/env bash
    set -euo pipefail

    tag=$(git describe --tags --abbrev=0)
    if gh release view "$tag" >/dev/null 2>&1; then
        echo "release $tag already exists"
        exit 0
    fi
    gh release create "$tag" --verify-tag --title "Release ${tag#v}" --generate-notes
