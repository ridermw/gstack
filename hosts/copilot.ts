import type { HostConfig } from '../scripts/host-config';

const copilot: HostConfig = {
  name: 'copilot',
  displayName: 'GitHub Copilot CLI',
  cliCommand: 'copilot',

  globalRoot: '.copilot/plugins/gstack',
  localSkillRoot: '.copilot-plugin/skills',
  hostSubdir: '.copilot-plugin',
  usesEnvVars: true,

  frontmatter: {
    mode: 'allowlist',
    keepFields: ['name', 'description'],
    descriptionLimit: null,
  },

  generation: {
    generateMetadata: false,
    skipSkills: ['codex'],
  },

  pathRewrites: [
    { from: '~/.claude/skills/gstack', to: '$GSTACK_ROOT' },
    { from: '.claude/skills/gstack', to: '.copilot-plugin/skills/gstack' },
    { from: '.claude/skills/review', to: '.copilot-plugin/skills/gstack-review' },
    { from: '.claude/skills', to: '.copilot-plugin/skills' },
  ],

  suppressedResolvers: [
    'DESIGN_OUTSIDE_VOICES',
    'ADVERSARIAL_STEP',
    'CODEX_SECOND_OPINION',
    'CODEX_PLAN_REVIEW',
    'REVIEW_ARMY',
    'GBRAIN_CONTEXT_LOAD',
    'GBRAIN_SAVE_RESULTS',
  ],

  runtimeRoot: {
    globalSymlinks: [
      'bin',
      'browse/dist',
      'browse/bin',
      'design/dist',
      'design-html/vendor/pretext',
      'gstack-upgrade',
      'ios-qa/templates',
      'lib',
      'review/specialists',
      'qa/templates',
      'qa/references',
      'plan-devex-review/dx-hall-of-fame.md',
      'scripts/jargon-list.json',
      'ETHOS.md',
      'VERSION',
    ],
    globalFiles: {
      'review': ['checklist.md', 'TODOS-format.md'],
    },
  },

  install: {
    prefixable: false,
    linkingStrategy: 'symlink-generated',
  },

  coAuthorTrailer: 'Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>',
  learningsMode: 'basic',
};

export default copilot;
