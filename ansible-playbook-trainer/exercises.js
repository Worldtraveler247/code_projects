// Twenty exercises in four levels. Each is plain data: the playbook the learner must
// produce. The brief, the model answer and the hints are all derived from `plays`.
// Host names, packages and paths are arbitrary practice values.
//
// Every play, from exercise 1 on, is a complete skeleton: name, hosts, become, gather_facts,
// variables (vars or vars_files) and at least one task that uses a variable.

export const LEVELS = {
  1: 'Level 1 · The full skeleton',
  2: 'Level 2 · Several tasks, richer variables',
  3: 'Level 3 · Task keywords',
  4: 'Level 4 · Full playbooks',
};

const dnf = (name, extra = {}) => ({ 'ansible.builtin.dnf': { name, state: 'present' }, ...extra });
const service = (name, state = 'started') => ({
  'ansible.builtin.service': state === 'started' ? { name, state, enabled: true } : { name, state },
});

export const EXERCISES = [
  // ---- Level 1: the whole skeleton with one task ----
  {
    id: 'skeleton-one-task',
    level: 1,
    title: 'The full skeleton',
    focus: 'Every playbook here has the same frame: the --- marker, a play opened by a dash, play keys at 2 spaces, variables at 4, a task opened by a dash at 4, its keys at 6 and module arguments at 8. A value that starts with {{ must be in double quotes.',
    plays: [{
      name: 'Install time sync', hosts: 'servera', become: true, gather_facts: false,
      vars: { time_package: 'chrony' },
      tasks: [{ name: 'Install the time sync package', ...dnf('{{ time_package }}') }],
    }],
  },
  {
    id: 'skeleton-service',
    level: 1,
    title: 'Two variables, three arguments',
    focus: 'Variables in the same dictionary share the 4-space column; arguments of the same module share the 8-space column. The name at 6 names the task; the name at 8 is an argument.',
    plays: [{
      name: 'Run the time service', hosts: 'serverb', become: true, gather_facts: false,
      vars: { time_service: 'chronyd', start_on_boot: true },
      tasks: [{
        name: 'Start the time service',
        'ansible.builtin.service': { name: '{{ time_service }}', state: 'started', enabled: '{{ start_on_boot }}' },
      }],
    }],
  },
  {
    id: 'skeleton-list-var',
    level: 1,
    title: 'A variable that holds a list',
    focus: 'A list is one level deeper than its variable: the variable at 4 spaces, each item at 6 with a dash. The task receives the whole list through one variable.',
    plays: [{
      name: 'Install the base tools', hosts: 'all', become: true, gather_facts: true,
      vars: { base_packages: ['vim-enhanced', 'tmux', 'bash-completion'] },
      tasks: [{ name: 'Install the base packages', ...dnf('{{ base_packages }}') }],
    }],
  },
  {
    id: 'skeleton-vars-files',
    level: 1,
    title: 'Variables from a file',
    focus: 'vars_files is a play key at 2 spaces that holds a list of file paths, each at 4 with a dash. Here deploy_user is defined in that file, and deploy_shell in vars. Both keys can sit in the same play.',
    plays: [{
      name: 'Create the deploy account', hosts: 'serverc', become: true, gather_facts: false,
      vars_files: ['vars/accounts.yml'],
      vars: { deploy_shell: '/bin/bash' },
      tasks: [{
        name: 'Create the deploy user',
        'ansible.builtin.user': { name: '{{ deploy_user }}', shell: '{{ deploy_shell }}', state: 'present' },
      }],
    }],
  },
  {
    id: 'skeleton-typed-vars',
    level: 1,
    title: 'A value that must stay text',
    focus: 'Quote the mode in vars. Unquoted, YAML reads 0755 as a number and the leading zero is lost. Paths and plain words need no quotes.',
    plays: [{
      name: 'Prepare the web root', hosts: 'serverd', become: true, gather_facts: false,
      vars: { web_root: '/var/www/portal', web_owner: 'apache', web_mode: '0755' },
      tasks: [{
        name: 'Create the web root',
        'ansible.builtin.file': { path: '{{ web_root }}', state: 'directory', owner: '{{ web_owner }}', mode: '{{ web_mode }}' },
      }],
    }],
  },

  // ---- Level 2: several tasks, richer variables ----
  {
    id: 'two-tasks',
    level: 2,
    title: 'Two tasks',
    focus: 'A new dash at 4 spaces closes the first task and opens the second. Tasks run in the order written, so this order does matter.',
    plays: [{
      name: 'Deploy the database', hosts: 'serverb', become: true, gather_facts: false,
      vars: { db_package: 'mariadb-server', db_service: 'mariadb' },
      tasks: [
        { name: 'Install the database package', ...dnf('{{ db_package }}') },
        { name: 'Start and enable the database', ...service('{{ db_service }}') },
      ],
    }],
  },
  {
    id: 'list-then-scalar',
    level: 2,
    title: 'Step in, then back out',
    focus: 'After the list ends, the next variable returns to 4 spaces. Stepping back out is what closes the list.',
    plays: [{
      name: 'Set up the firewall', hosts: 'all', become: true, gather_facts: false,
      vars: { fw_packages: ['firewalld', 'python3-firewall'], fw_service: 'firewalld' },
      tasks: [
        { name: 'Install the firewall packages', ...dnf('{{ fw_packages }}') },
        { name: 'Start and enable the firewall', ...service('{{ fw_service }}') },
      ],
    }],
  },
  {
    id: 'nested-var',
    level: 2,
    title: 'A variable that holds keys',
    focus: 'A variable can hold a dictionary: its keys go at 6 spaces with no dash, and a task reads one as app.user. Quote the mode so it stays text.',
    plays: [{
      name: 'Prepare the application account', hosts: 'serverc', become: true, gather_facts: false,
      vars: { app: { user: 'appsvc', group: 'appsvc', home: '/opt/inventory' } },
      tasks: [
        { name: 'Create the application group', 'ansible.builtin.group': { name: '{{ app.group }}', state: 'present' } },
        { name: 'Create the application user', 'ansible.builtin.user': { name: '{{ app.user }}', group: '{{ app.group }}', shell: '/sbin/nologin' } },
        { name: 'Create the application directory', 'ansible.builtin.file': { path: '{{ app.home }}', state: 'directory', owner: '{{ app.user }}', group: '{{ app.group }}', mode: '0750' } },
      ],
    }],
  },
  {
    id: 'block-text',
    level: 2,
    title: 'A block of text',
    focus: 'A pipe after content means the lines below are kept exactly as typed. They sit 2 spaces deeper than content, and the next argument steps back out to 8.',
    plays: [{
      name: 'Publish the login banner', hosts: 'servera', become: true, gather_facts: false,
      vars: { banner_path: '/etc/issue.net', banner_owner: 'root' },
      tasks: [
        {
          name: 'Write the banner file',
          'ansible.builtin.copy': {
            dest: '{{ banner_path }}',
            content: 'Authorized users only.\nActivity is monitored.\n',
            owner: '{{ banner_owner }}', mode: '0644',
          },
        },
        {
          name: 'Point the SSH daemon at the banner',
          'ansible.builtin.lineinfile': { path: '/etc/ssh/sshd_config', regexp: '^#?Banner', line: 'Banner {{ banner_path }}' },
        },
      ],
    }],
  },
  {
    id: 'two-plays',
    level: 2,
    title: 'Two plays in one playbook',
    focus: 'A second dash in column 1 closes the first play and opens another, with its own hosts, variables and tasks. There is still only one --- marker, on line 1.',
    plays: [
      {
        name: 'Configure web servers', hosts: 'servera', become: true, gather_facts: false,
        vars: { web_package: 'httpd' },
        tasks: [{ name: 'Install the web server', ...dnf('{{ web_package }}') }],
      },
      {
        name: 'Configure database servers', hosts: 'serverb', become: true, gather_facts: false,
        vars: { db_package: 'mariadb-server' },
        tasks: [{ name: 'Install the database server', ...dnf('{{ db_package }}') }],
      },
    ],
  },

  // ---- Level 3: task keywords ----
  {
    id: 'task-when',
    level: 3,
    title: 'A condition with when',
    focus: 'when modifies the task, not the module, so it sits at 6 spaces, level with the module name. It is already an expression, so it takes no {{ }}.',
    plays: [{
      name: 'Install the web server', hosts: 'servera', become: true, gather_facts: true,
      vars: { web_package: 'httpd' },
      tasks: [{
        name: 'Install the web server on Red Hat systems',
        ...dnf('{{ web_package }}', { when: "ansible_facts['os_family'] == 'RedHat'" }),
      }],
    }],
  },
  {
    id: 'task-loop',
    level: 3,
    title: 'Repeat a task with loop',
    focus: 'loop is a task keyword at 6 spaces. Here it receives a list variable, so it needs the quotes; inside the task, item is the current entry.',
    plays: [{
      name: 'Create the operations team', hosts: 'serverd', become: true, gather_facts: false,
      vars: { ops_users: ['alice', 'bob', 'carol'], ops_group: 'wheel' },
      tasks: [{
        name: 'Create operator accounts',
        'ansible.builtin.user': { name: '{{ item }}', groups: '{{ ops_group }}', append: true, state: 'present' },
        loop: '{{ ops_users }}',
      }],
    }],
  },
  {
    id: 'task-register',
    level: 3,
    title: 'Save a result with register',
    focus: 'register and changed_when are task keywords at 6 spaces. The second task reads what the first one saved. The debug argument var takes a variable name, with no {{ }}.',
    plays: [{
      name: 'Report uptime', hosts: 'all', become: false, gather_facts: false,
      vars: { report_command: 'uptime' },
      tasks: [
        { name: 'Read the uptime', 'ansible.builtin.command': { cmd: '{{ report_command }}' }, register: 'uptime_result', changed_when: false },
        { name: 'Show the uptime', 'ansible.builtin.debug': { var: 'uptime_result.stdout' } },
      ],
    }],
  },
  {
    id: 'task-notify',
    level: 3,
    title: 'Notify a handler',
    focus: 'handlers is a play key at 2 spaces, a sibling of tasks. The notify text must match the handler name exactly, capital letters included.',
    plays: [{
      name: 'Harden the SSH daemon', hosts: 'serverb', become: true, gather_facts: false,
      vars: { ssh_service: 'sshd', ssh_dropin: '/etc/ssh/sshd_config.d/50-hardening.conf' },
      tasks: [{
        name: 'Deploy the hardening settings',
        'ansible.builtin.copy': {
          dest: '{{ ssh_dropin }}',
          content: 'PermitRootLogin no\nPasswordAuthentication no\n',
          owner: 'root', group: 'root', mode: '0600',
        },
        notify: 'Restart sshd',
      }],
      handlers: [{ name: 'Restart sshd', ...service('{{ ssh_service }}', 'restarted') }],
    }],
  },
  {
    id: 'loop-and-when',
    level: 3,
    title: 'loop and when on one task',
    focus: 'Two task keywords on one task: both at 6 spaces, in either order. when names a true/false variable directly.',
    plays: [{
      name: 'Open the firewall', hosts: 'servera', become: true, gather_facts: true,
      vars: { fw_services: ['http', 'https'], manage_firewall: true },
      tasks: [{
        name: 'Allow the web services',
        'ansible.posix.firewalld': { service: '{{ item }}', permanent: true, immediate: true, state: 'enabled' },
        loop: '{{ fw_services }}',
        when: 'manage_firewall',
      }],
    }],
  },

  // ---- Level 4: full playbooks ----
  {
    id: 'tls-site',
    level: 4,
    title: 'Three tasks and mixed variables',
    focus: 'A list, a path and a true/false value in vars, then three tasks. No new rules: count the columns.',
    plays: [{
      name: 'Deploy the TLS site', hosts: 'serverc', become: true, gather_facts: true,
      vars: { web_packages: ['httpd', 'mod_ssl'], site_root: '/var/www/secure', enable_tls: true },
      tasks: [
        { name: 'Install the web packages', ...dnf('{{ web_packages }}') },
        { name: 'Create the site root', 'ansible.builtin.file': { path: '{{ site_root }}', state: 'directory', mode: '0755' } },
        {
          name: 'Allow HTTPS through the firewall',
          'ansible.posix.firewalld': { service: 'https', permanent: true, immediate: true, state: 'enabled' },
          when: 'enable_tls',
        },
      ],
    }],
  },
  {
    id: 'vars-files-handler',
    level: 4,
    title: 'A variables file, three tasks and a handler',
    focus: 'vars_files and vars together, a notification in the middle task, and handlers back at 2 spaces. ntp_pool comes from the variables file.',
    plays: [{
      name: 'Configure time sync', hosts: 'all', become: true, gather_facts: false,
      vars_files: ['vars/time.yml'],
      vars: { chrony_conf: '/etc/chrony.conf', chrony_service: 'chronyd' },
      tasks: [
        { name: 'Install chrony', ...dnf('chrony') },
        {
          name: 'Set the time source',
          'ansible.builtin.lineinfile': { path: '{{ chrony_conf }}', regexp: '^pool', line: 'pool {{ ntp_pool }} iburst' },
          notify: 'Restart chrony',
        },
        { name: 'Start and enable chrony', ...service('{{ chrony_service }}') },
      ],
      handlers: [{ name: 'Restart chrony', ...service('{{ chrony_service }}', 'restarted') }],
    }],
  },
  {
    id: 'two-plays-full',
    level: 4,
    title: 'Two full plays',
    focus: 'Each play carries its own variables and tasks. A variable defined in one play does not exist in the other.',
    plays: [
      {
        name: 'Configure web servers', hosts: 'servera', become: true, gather_facts: false,
        vars: { web_package: 'httpd', web_service: 'httpd' },
        tasks: [
          { name: 'Install the web server', ...dnf('{{ web_package }}') },
          { name: 'Start and enable the web server', ...service('{{ web_service }}') },
        ],
      },
      {
        name: 'Configure database servers', hosts: 'serverb', become: true, gather_facts: false,
        vars: { db_package: 'mariadb-server', db_service: 'mariadb', db_port: 3306 },
        tasks: [
          { name: 'Install the database server', ...dnf('{{ db_package }}') },
          { name: 'Start and enable the database server', ...service('{{ db_service }}') },
          {
            name: 'Allow the database port',
            'ansible.posix.firewalld': { port: '{{ db_port }}/tcp', permanent: true, immediate: true, state: 'enabled' },
          },
        ],
      },
    ],
  },
  {
    id: 'audit-accounts',
    level: 4,
    title: 'loop, register and when together',
    focus: 'Four tasks using every task keyword so far. Each keyword sits at 6 spaces on the task it belongs to.',
    plays: [{
      name: 'Create the audit team', hosts: 'serverd', become: true, gather_facts: false,
      vars: { audit_users: ['dave', 'erin'], audit_group: 'auditors' },
      tasks: [
        { name: 'Create the audit group', 'ansible.builtin.group': { name: '{{ audit_group }}', state: 'present' } },
        {
          name: 'Create the audit accounts',
          'ansible.builtin.user': { name: '{{ item }}', groups: '{{ audit_group }}', append: true },
          loop: '{{ audit_users }}',
        },
        {
          name: 'Read the group entry',
          'ansible.builtin.command': { cmd: 'getent group {{ audit_group }}' },
          register: 'group_entry', changed_when: false,
        },
        { name: 'Show the group entry', 'ansible.builtin.debug': { var: 'group_entry.stdout' }, when: 'group_entry.rc == 0' },
      ],
    }],
  },
  {
    id: 'capstone',
    level: 4,
    title: 'Capstone: a hardened web server',
    focus: 'The playbook from the guide, written from memory: play keys, variables, three tasks, a condition, a block of text, a notification and a handler.',
    plays: [{
      name: 'Deploy a hardened web server', hosts: 'servera', become: true, gather_facts: true,
      vars: { web_packages: ['httpd', 'mod_ssl'], web_service: 'httpd' },
      tasks: [
        {
          name: 'Install web packages',
          ...dnf('{{ web_packages }}', { when: "ansible_facts['os_family'] == 'RedHat'" }),
        },
        {
          name: 'Hide the Apache version banner',
          'ansible.builtin.copy': {
            dest: '/etc/httpd/conf.d/security.conf',
            content: 'ServerTokens Prod\nServerSignature Off\n',
            owner: 'root', group: 'root', mode: '0644',
          },
          notify: 'Restart web service',
        },
        { name: 'Start and enable the web service', ...service('{{ web_service }}') },
      ],
      handlers: [{ name: 'Restart web service', ...service('{{ web_service }}', 'restarted') }],
    }],
  },
];
