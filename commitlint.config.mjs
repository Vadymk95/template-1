const config = {
    extends: ['@commitlint/config-conventional'],
    rules: {
        'type-enum': [
            2,
            'always',
            ['feat', 'fix', 'chore', 'docs', 'style', 'refactor', 'perf', 'test', 'revert']
        ],
        'header-max-length': [2, 'always', 96]
    }
};

// Example commit message
// feat(blog): add comment section

export default config;
