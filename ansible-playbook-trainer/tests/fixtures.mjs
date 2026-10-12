// Small playbooks used only by the checker tests, so those tests do not change when the
// shipped exercises do.

export const FIXTURES = [
  {
    id: 'play-name-hosts',
    plays: [{ name: 'Check connectivity', hosts: 'servera' }],
  },
  {
    id: 'play-become',
    plays: [{ name: 'Patch the database tier', hosts: 'serverb', become: true }],
  },
  {
    id: 'play-gather-facts',
    plays: [{ name: 'Run a quick audit', hosts: 'all', become: false, gather_facts: false }],
  },
  {
    id: 'play-five-keys',
    plays: [{ name: 'Prepare the web tier', hosts: 'webservers', remote_user: 'devops', become: true, gather_facts: true }],
  },
  {
    id: 'two-plays',
    plays: [
      { name: 'Configure web servers', hosts: 'servera', become: true },
      { name: 'Configure database servers', hosts: 'serverb', become: true, gather_facts: false },
    ],
  },

  {
    id: 'vars-one',
    plays: [{ name: 'Set one variable', hosts: 'servera', vars: { web_service: 'httpd' } }],
  },
  {
    id: 'vars-three',
    plays: [{
      name: 'Describe the web site', hosts: 'serverc', become: true,
      vars: { http_port: 8080, enable_tls: true, doc_root: '/var/www/html' },
    }],
  },
  {
    id: 'vars-list',
    plays: [{ name: 'List the base packages', hosts: 'all', vars: { base_packages: ['chrony', 'firewalld', 'vim-enhanced'] } }],
  },
  {
    id: 'vars-back-out',
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
    plays: [{
      name: 'Describe the application', hosts: 'servera',
      vars: {
        app: { name: 'inventory', port: 5000, owner: 'appsvc' },
        backup_dirs: ['/etc', '/var/lib/inventory'],
      },
    }],
  },

  {
    id: 'task-one',
    plays: [{
      name: 'Install time sync', hosts: 'servera', become: true,
      tasks: [{ name: 'Install chrony', 'ansible.builtin.dnf': { name: 'chrony', state: 'present' } }],
    }],
  },
  {
    id: 'task-three-args',
    plays: [{
      name: 'Run time sync', hosts: 'serverb', become: true,
      tasks: [{ name: 'Start and enable chronyd', 'ansible.builtin.service': { name: 'chronyd', state: 'started', enabled: true } }],
    }],
  },
  {
    id: 'task-two',
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
    plays: [{
      name: 'Prepare the application account', hosts: 'serverc', become: true,
      tasks: [
        { name: 'Create the application group', 'ansible.builtin.group': { name: 'appsvc', state: 'present' } },
        { name: 'Create the application user', 'ansible.builtin.user': { name: 'appsvc', group: 'appsvc', shell: '/sbin/nologin' } },
        { name: 'Create the application directory', 'ansible.builtin.file': { path: '/opt/inventory', state: 'directory', owner: 'appsvc', group: 'appsvc', mode: '0750' } },
      ],
    }],
  },

  {
    id: 'task-when',
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
