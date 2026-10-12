// Twenty exercises in four levels. Each is plain data: the playbook the learner must
// produce. The brief, the model answer and the hints are all derived from `plays`.
// Host names, packages and paths are arbitrary practice values.

export const LEVELS = {
  1: 'Level 1 · Play keys',
  2: 'Level 2 · Variables',
  3: 'Level 3 · Tasks',
  4: 'Level 4 · Task keywords and handlers',
};

export const EXERCISES = [
  // ---- Level 1: the document marker and the keys of a play ----
  {
    id: 'play-name-hosts',
    level: 1,
    title: 'Your first play',
    focus: 'A playbook is a list of plays. Line 1 is the --- marker. The dash in column 1 opens the play, and the second key lines up under the first, at 2 spaces.',
    plays: [{ name: 'Check connectivity', hosts: 'servera' }],
  },
  {
    id: 'play-become',
    level: 1,
    title: 'Add privilege escalation',
    focus: 'Every key of the play sits in the same column. Only the first one carries the dash.',
    plays: [{ name: 'Patch the database tier', hosts: 'serverb', become: true }],
  },
  {
    id: 'play-gather-facts',
    level: 1,
    title: 'Switch fact gathering off',
    focus: 'true and false are written without quotes. Try the keys in a different order from the brief: the play is a dictionary, so the order does not matter.',
    plays: [{ name: 'Run a quick audit', hosts: 'all', become: false, gather_facts: false }],
  },
  {
    id: 'play-five-keys',
    level: 1,
    title: 'Five play keys',
    focus: 'More keys, same rule: one dash, then everything else at 2 spaces.',
    plays: [{ name: 'Prepare the web tier', hosts: 'webservers', remote_user: 'devops', become: true, gather_facts: true }],
  },
  {
    id: 'two-plays',
    level: 1,
    title: 'Two plays in one playbook',
    focus: 'A second dash in column 1 closes the first play and opens another. There is still only one --- marker, on line 1.',
    plays: [
      { name: 'Configure web servers', hosts: 'servera', become: true },
      { name: 'Configure database servers', hosts: 'serverb', become: true, gather_facts: false },
    ],
  },

  // ---- Level 2: vars ----
  {
    id: 'vars-one',
    level: 2,
    title: 'One variable',
    focus: 'vars ends in a colon with nothing after it, so its value is on the next line, one level deeper: 4 spaces.',
    plays: [{ name: 'Set one variable', hosts: 'servera', vars: { web_service: 'httpd' } }],
  },
  {
    id: 'vars-three',
    level: 2,
    title: 'Three variables of different types',
    focus: 'Variables in the same dictionary share a column. Numbers and true/false are written bare; a path needs no quotes.',
    plays: [{
      name: 'Describe the web site', hosts: 'serverc', become: true,
      vars: { http_port: 8080, enable_tls: true, doc_root: '/var/www/html' },
    }],
  },
  {
    id: 'vars-list',
    level: 2,
    title: 'A variable that holds a list',
    focus: 'A list is one more level in: the variable at 4, each item at 6 with a dash. Items of one list share a column.',
    plays: [{ name: 'List the base packages', hosts: 'all', vars: { base_packages: ['chrony', 'firewalld', 'vim-enhanced'] } }],
  },
  {
    id: 'vars-back-out',
    level: 2,
    title: 'Step in, then back out',
    focus: 'After a list ends, the next variable returns to 4 spaces. Stepping back out is what closes the list.',
    plays: [{
      name: 'Define the admin team', hosts: 'serverd', become: true,
      vars: {
        admin_users: ['alice', 'bob'],
        admin_group: 'wheel',
        ntp_servers: ['0.pool.ntp.org', '1.pool.ntp.org'],
        timezone: 'Asia/Tokyo',
      },
    }],
  },
  {
    id: 'vars-nested',
    level: 2,
    title: 'A variable that holds keys',
    focus: 'A variable can hold a dictionary instead of a list: its keys go at 6 spaces with no dash.',
    plays: [{
      name: 'Describe the application', hosts: 'servera',
      vars: {
        app: { name: 'inventory', port: 5000, owner: 'appsvc' },
        backup_dirs: ['/etc', '/var/lib/inventory'],
      },
    }],
  },

  // ---- Level 3: tasks ----
  {
    id: 'task-one',
    level: 3,
    title: 'Your first task',
    focus: 'tasks holds a list: the dash goes at 4 spaces, the keys of the task at 6, and the arguments of the module at 8.',
    plays: [{
      name: 'Install time sync', hosts: 'servera', become: true,
      tasks: [{ name: 'Install chrony', 'ansible.builtin.dnf': { name: 'chrony', state: 'present' } }],
    }],
  },
  {
    id: 'task-three-args',
    level: 3,
    title: 'A module with three arguments',
    focus: 'All arguments of one module share the 8-space column. The name at 6 is the name of the task; the name at 8 is an argument to the module.',
    plays: [{
      name: 'Run time sync', hosts: 'serverb', become: true,
      tasks: [{ name: 'Start and enable chronyd', 'ansible.builtin.service': { name: 'chronyd', state: 'started', enabled: true } }],
    }],
  },
  {
    id: 'task-two',
    level: 3,
    title: 'Two tasks',
    focus: 'A new dash at 4 spaces closes the first task and opens the second. Tasks run in the order written, so this order does matter.',
    plays: [{
      name: 'Set up the firewall', hosts: 'all', become: true,
      tasks: [
        { name: 'Install firewalld', 'ansible.builtin.dnf': { name: 'firewalld', state: 'present' } },
        { name: 'Start and enable firewalld', 'ansible.builtin.service': { name: 'firewalld', state: 'started', enabled: true } },
      ],
    }],
  },
  {
    id: 'task-with-vars',
    level: 3,
    title: 'Variables feeding tasks',
    focus: 'A value that starts with {{ must be wrapped in double quotes, or YAML reads the brace as a dictionary.',
    plays: [{
      name: 'Deploy the database', hosts: 'serverb', become: true,
      vars: { db_package: 'mariadb-server', db_service: 'mariadb' },
      tasks: [
        { name: 'Install the database package', 'ansible.builtin.dnf': { name: '{{ db_package }}', state: 'present' } },
        { name: 'Start and enable the database', 'ansible.builtin.service': { name: '{{ db_service }}', state: 'started', enabled: true } },
      ],
    }],
  },
  {
    id: 'task-three',
    level: 3,
    title: 'Three tasks and a file mode',
    focus: 'Quote the mode. Unquoted, YAML reads 0750 as a number and the leading zero is lost.',
    plays: [{
      name: 'Prepare the application account', hosts: 'serverc', become: true,
      tasks: [
        { name: 'Create the application group', 'ansible.builtin.group': { name: 'appsvc', state: 'present' } },
        { name: 'Create the application user', 'ansible.builtin.user': { name: 'appsvc', group: 'appsvc', shell: '/sbin/nologin' } },
        { name: 'Create the application directory', 'ansible.builtin.file': { path: '/opt/inventory', state: 'directory', owner: 'appsvc', group: 'appsvc', mode: '0750' } },
      ],
    }],
  },

  // ---- Level 4: task keywords, handlers, capstone ----
  {
    id: 'task-when',
    level: 4,
    title: 'A condition with when',
    focus: 'when modifies the task, not the module, so it sits at 6 spaces, level with the module name. It takes no {{ }}.',
    plays: [{
      name: 'Install the web server', hosts: 'servera', become: true, gather_facts: true,
      tasks: [{
        name: 'Install httpd on Red Hat systems',
        'ansible.builtin.dnf': { name: 'httpd', state: 'present' },
        when: "ansible_facts['os_family'] == 'RedHat'",
      }],
    }],
  },
  {
    id: 'task-loop',
    level: 4,
    title: 'Repeat a task with loop',
    focus: 'loop is at 6 spaces and its items are a list one level deeper, at 8. They share a column with the module arguments but belong to loop.',
    plays: [{
      name: 'Create the operations team', hosts: 'serverd', become: true,
      tasks: [{
        name: 'Create operator accounts',
        'ansible.builtin.user': { name: '{{ item }}', groups: 'wheel', append: true, state: 'present' },
        loop: ['alice', 'bob', 'carol'],
      }],
    }],
  },
  {
    id: 'task-register',
    level: 4,
    title: 'Save a result with register',
    focus: 'register and changed_when are task keywords at 6 spaces. The second task reads what the first one saved.',
    plays: [{
      name: 'Report uptime', hosts: 'all', gather_facts: false,
      tasks: [
        { name: 'Read the uptime', 'ansible.builtin.command': { cmd: 'uptime' }, register: 'uptime_result', changed_when: false },
        { name: 'Show the uptime', 'ansible.builtin.debug': { var: 'uptime_result.stdout' } },
      ],
    }],
  },
  {
    id: 'task-notify-handler',
    level: 4,
    title: 'Notify a handler',
    focus: 'handlers is a play key at 2 spaces, a sibling of tasks. The notify text must match the handler name exactly. Text under a pipe is kept as typed.',
    plays: [{
      name: 'Harden the SSH daemon', hosts: 'serverb', become: true,
      tasks: [{
        name: 'Deploy the hardening settings',
        'ansible.builtin.copy': {
          dest: '/etc/ssh/sshd_config.d/50-hardening.conf',
          content: 'PermitRootLogin no\nPasswordAuthentication no\n',
          owner: 'root', group: 'root', mode: '0600',
        },
        notify: 'Restart sshd',
      }],
      handlers: [{ name: 'Restart sshd', 'ansible.builtin.service': { name: 'sshd', state: 'restarted' } }],
    }],
  },
  {
    id: 'capstone',
    level: 4,
    title: 'Capstone: a hardened web server',
    focus: 'Everything at once: play keys, variables, three tasks, a condition, a block of text, a notification and a handler. No new rules.',
    plays: [{
      name: 'Deploy a hardened web server', hosts: 'servera', become: true, gather_facts: true,
      vars: { web_packages: ['httpd', 'mod_ssl'], web_service: 'httpd' },
      tasks: [
        {
          name: 'Install web packages',
          'ansible.builtin.dnf': { name: '{{ web_packages }}', state: 'present' },
          when: "ansible_facts['os_family'] == 'RedHat'",
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
        { name: 'Start and enable the web service', 'ansible.builtin.service': { name: '{{ web_service }}', state: 'started', enabled: true } },
      ],
      handlers: [{ name: 'Restart web service', 'ansible.builtin.service': { name: '{{ web_service }}', state: 'restarted' } }],
    }],
  },
];
