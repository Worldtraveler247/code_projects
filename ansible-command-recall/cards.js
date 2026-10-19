// The question bank. To add a card, copy one entry and change it; the tests check every field.
//
//   id      unique, never reused (progress is saved by id)
//   deck    one of DECKS below
//   q       the question
//   answer  what you would type; multi-line for ini cards
//   kind    'command' (default), 'ini' (ansible.cfg / inventory file) or 'hosts' (a list of host names)
//   why     one line on what the command does or the trap in it
//   flags   optional [flag, meaning] pairs shown with the answer

export const DECKS = [
  { id: 'prep', name: 'Control node prep' },
  { id: 'config', name: 'ansible.cfg' },
  { id: 'inventory', name: 'Inventory' },
  { id: 'adhoc', name: 'Ad hoc commands' },
];

export const INVENTORY = `[dev]
servera

[test]
serverb

[prod]
serverb
serverc

[balancers]
serverd

[webservers:children]
prod`;

export const CARDS = [
  // ---- Control node prep ----
  {
    id: 'vimrc-open', deck: 'prep',
    q: 'What is the command to open your Vim config file for editing?',
    answer: 'vi ~/.vimrc',
    why: 'Per-user Vim settings live in ~/.vimrc. Set it up before writing any YAML.',
  },
  {
    id: 'vimrc-line', deck: 'prep',
    q: 'What line goes in ~/.vimrc so YAML files get auto-indent, 2-space tabs, a cursor column and line, line numbers, and spaces instead of tab characters?',
    answer: 'autocmd FileType yaml setlocal ai ts=2 sts=2 sw=2 cuc cul nu expandtab',
    why: 'YAML forbids tab characters for indentation; expandtab turns Tab into spaces.',
    flags: [
      ['autocmd FileType yaml', 'run the rest only when the file type is YAML'],
      ['setlocal', 'apply to this buffer only'],
      ['ai', 'autoindent: a new line keeps the indent of the one above'],
      ['ts=2', 'tabstop: a tab character displays as 2 columns'],
      ['sts=2', 'softtabstop: Tab and Backspace move 2 columns'],
      ['sw=2', 'shiftwidth: >> and << shift by 2 columns'],
      ['cuc', 'cursorcolumn: highlight the cursor column, to line up indentation'],
      ['cul', 'cursorline: highlight the cursor line'],
      ['nu', 'number: show line numbers, to match error messages'],
      ['expandtab', 'insert spaces when Tab is pressed'],
    ],
  },
  {
    id: 'useradd', deck: 'prep',
    q: 'What is the command to create the user ecamacho?',
    answer: 'useradd ecamacho',
    why: 'Run as root. Creates the account and, on RHEL, its home directory and a matching group.',
  },
  {
    id: 'passwd', deck: 'prep',
    q: 'What is the command to set a password for ecamacho?',
    answer: 'passwd ecamacho',
    why: 'Lowercase. Linux commands are case-sensitive, so "Passwd" is "command not found".',
  },
  {
    id: 'sudoers', deck: 'prep',
    q: 'What is the command to give ecamacho passwordless sudo with a drop-in file?',
    answer: 'echo "ecamacho ALL=(ALL) NOPASSWD: ALL" > /etc/sudoers.d/ecamacho',
    why: 'Ansible needs non-interactive sudo for become. Check the file afterwards with visudo -cf /etc/sudoers.d/ecamacho: a syntax error in sudoers can lock everyone out of sudo.',
    flags: [
      ['ecamacho', 'the user this rule applies to'],
      ['ALL=', 'on any host'],
      ['(ALL)', 'as any target user'],
      ['NOPASSWD:', 'without asking for a password'],
      ['ALL', 'for any command'],
    ],
  },
  {
    id: 'ssh-keygen', deck: 'prep',
    q: 'What is the command to generate an SSH key pair?',
    answer: 'ssh-keygen',
    why: 'Press Enter at each prompt for the defaults. RHEL 9 (OpenSSH 8.7) makes an RSA key, ~/.ssh/id_rsa; OpenSSH 9.5 and later default to Ed25519. The private key stays here; only the .pub file is copied out.',
  },
  {
    id: 'ssh-copy-id', deck: 'prep',
    q: 'What is the command to copy your public key to servera for the user ecamacho?',
    answer: 'ssh-copy-id ecamacho@servera',
    why: 'Appends your public key to ~ecamacho/.ssh/authorized_keys on servera, so Ansible can log in without a password.',
  },

  // ---- ansible.cfg ----
  {
    id: 'cfg-inventory', deck: 'config',
    q: 'In ansible.cfg, what line points Ansible at /home/ecamacho/my-ansible-project/inventory?',
    answer: 'inventory = /home/ecamacho/my-ansible-project/inventory',
    kind: 'ini',
    why: 'Goes under [defaults]. With it set you can leave -i off every command.',
  },
  {
    id: 'cfg-remote-user', deck: 'config',
    q: 'In ansible.cfg, what line makes Ansible log in to managed hosts as ecamacho?',
    answer: 'remote_user = ecamacho',
    kind: 'ini',
    why: 'Goes under [defaults]. The command-line equivalent is -u ecamacho.',
  },
  {
    id: 'cfg-host-key', deck: 'config',
    q: 'In ansible.cfg, what line stops Ansible asking you to accept each new host key?',
    answer: 'host_key_checking = false',
    kind: 'ini',
    why: 'Goes under [defaults]. Fine in a lab; in production, pre-load known_hosts instead, because this turns off the check that detects a spoofed host.',
  },
  {
    id: 'cfg-become', deck: 'config',
    q: 'Write the ansible.cfg section that leaves privilege escalation off by default.',
    answer: '[privilege_escalation]\nbecome = false',
    kind: 'ini',
    why: 'With become off by default, a task or command must ask for root itself, with become: true or -b.',
  },
  {
    id: 'cfg-full', deck: 'config',
    q: 'Write the whole ansible.cfg: the inventory path, remote user ecamacho, no host key checking, and become off.',
    answer: '[defaults]\ninventory = /home/ecamacho/my-ansible-project/inventory\nremote_user = ecamacho\nhost_key_checking = false\n\n[privilege_escalation]\nbecome = false',
    kind: 'ini',
    why: 'Ansible reads ./ansible.cfg in the directory you run from, so keep it in the project directory.',
  },

  // ---- Inventory ----
  {
    id: 'inv-dev', deck: 'inventory',
    q: 'In the inventory file, write the group dev containing servera.',
    answer: '[dev]\nservera',
    kind: 'ini',
    why: 'A group is a [name] header followed by one host per line.',
  },
  {
    id: 'inv-prod', deck: 'inventory',
    q: 'In the inventory file, write the group prod containing serverb and serverc.',
    answer: '[prod]\nserverb\nserverc',
    kind: 'ini',
    why: 'A host may sit in several groups; serverb is in both test and prod.',
  },
  {
    id: 'inv-children', deck: 'inventory',
    q: 'In the inventory file, make the group webservers contain every host in the group prod.',
    answer: '[webservers:children]\nprod',
    kind: 'ini',
    why: ':children lists groups, not hosts. Add a host to prod and it is in webservers too.',
  },
  {
    id: 'inv-full', deck: 'inventory',
    q: 'Write the whole inventory: dev = servera, test = serverb, prod = serverb and serverc, balancers = serverd, and webservers made of the prod group.',
    answer: INVENTORY,
    kind: 'ini',
    why: 'Groups may come in any order. Check your work with ansible-inventory --graph.',
  },
  {
    id: 'version', deck: 'inventory',
    q: 'What is the command to show the Ansible version and which ansible.cfg is in use?',
    answer: 'ansible --version',
    why: 'Two hyphens. The "config file =" line tells you which ansible.cfg won.',
  },
  {
    id: 'inv-list', deck: 'inventory',
    q: 'What is the command to print the inventory file "inventory" as JSON, with every group and host variable?',
    answer: 'ansible-inventory -i inventory --list',
    why: 'Shows the inventory the way Ansible parsed it, not the way you wrote it.',
    flags: [['-i inventory', 'use this inventory file'], ['--list', 'print every group and host as JSON']],
  },
  {
    id: 'inv-graph', deck: 'inventory',
    q: 'What is the command to draw the inventory file "inventory" as a tree of groups and hosts?',
    answer: 'ansible-inventory -i inventory --graph',
    why: 'The fastest way to see that webservers holds prod, and prod holds serverb and serverc.',
    flags: [['-i inventory', 'use this inventory file'], ['--graph', 'print groups and hosts as a tree']],
  },
  {
    id: 'ping', deck: 'inventory',
    q: 'What is the command to test that Ansible can log in to every host in webservers, using the inventory file "inventory"?',
    answer: 'ansible -i inventory webservers -m ping',
    why: 'ping is not ICMP: it logs in over SSH and checks Python works. "pong" means Ansible can manage the host.',
    flags: [['-i inventory', 'use this inventory file'], ['webservers', 'the host pattern'], ['-m ping', 'run the ping module']],
  },
  {
    id: 'hosts-web', deck: 'inventory',
    q: 'What is the command to list the hosts in webservers without running anything, using the inventory file "inventory"?',
    answer: 'ansible webservers -i inventory --list-hosts',
    why: 'Prints the hosts a pattern matches. Use it before any command that changes something.',
  },
  {
    id: 'hosts-prod', deck: 'inventory',
    q: 'What is the command to list the hosts in prod, using the inventory file "inventory"?',
    answer: 'ansible prod -i inventory --list-hosts',
    why: 'Prints serverb and serverc.',
  },
  {
    id: 'hosts-test', deck: 'inventory',
    q: 'What is the command to list the hosts in test, using the inventory file "inventory"?',
    answer: 'ansible test -i inventory --list-hosts',
    why: 'Prints serverb.',
  },
  {
    id: 'hosts-all', deck: 'inventory',
    q: 'What is the command to list every host in the inventory file "inventory"?',
    answer: 'ansible all -i inventory --list-hosts',
    why: 'all is a built-in group: every host in the inventory.',
  },
  {
    id: 'predict-web', deck: 'inventory',
    q: 'With this inventory, which hosts does "ansible webservers --list-hosts" print?',
    answer: 'serverb serverc',
    kind: 'hosts',
    show: INVENTORY,
    why: 'webservers has no hosts of its own; it takes every host in its child group prod.',
  },
  {
    id: 'predict-all', deck: 'inventory',
    q: 'With this inventory, which hosts does "ansible all --list-hosts" print?',
    answer: 'servera serverb serverc serverd',
    kind: 'hosts',
    show: INVENTORY,
    why: 'serverb is in two groups but is listed once: all is a set of hosts, not of group entries.',
  },

  // ---- Ad hoc commands ----
  {
    id: 'hostvars', deck: 'adhoc',
    q: 'What is the ad hoc command to print every variable Ansible holds for each host, run against servera?',
    answer: 'ansible servera -m debug -a "var=hostvars"',
    why: 'hostvars holds the variables of every host in the inventory, not only servera.',
    flags: [['-m debug', 'run the debug module'], ['-a "var=hostvars"', 'print the variable hostvars']],
  },
  {
    id: 'facts', deck: 'adhoc',
    q: 'What is the ad hoc command to gather servera\'s facts with privilege escalation and save them to facts.txt?',
    answer: 'ansible servera -m setup -b > facts.txt',
    why: 'Some facts are only readable as root, so -b gives you the full set. Search the file for ansible_ names to use in playbooks.',
    flags: [['-m setup', 'run the setup module, which gathers facts'], ['-b', 'become root on the managed host'], ['> facts.txt', 'the shell saves the output to a file']],
  },
  {
    id: 'user-add', deck: 'adhoc',
    q: 'What is the ad hoc command to create the user ljames, comment "Lebron James", shell /bin/bash, on every host in webservers?',
    answer: 'ansible webservers -m ansible.builtin.user -a "name=ljames comment=\'Lebron James\' shell=/bin/bash state=present"',
    why: 'The inner single quotes keep "Lebron James" as one value. Creating users needs root: add -b unless become is on in ansible.cfg.',
    flags: [['name=ljames', 'the account'], ['comment=', 'the GECOS field, usually the full name'], ['shell=/bin/bash', 'the login shell'], ['state=present', 'the user must exist']],
  },
  {
    id: 'user-remove', deck: 'adhoc',
    q: 'What is the ad hoc command to delete the user ljames and the home directory from every host in webservers?',
    answer: 'ansible webservers -m ansible.builtin.user -a "name=ljames state=absent remove=true"',
    why: 'remove=true is userdel -r: without it the home directory stays behind.',
    flags: [['state=absent', 'the user must not exist'], ['remove=true', 'also delete the home directory and mail spool']],
  },
  {
    id: 'user-verify', deck: 'adhoc',
    q: 'What is the ad hoc command to check that the user ljames exists on every host in webservers?',
    answer: 'ansible webservers -m command -a "id ljames"',
    why: 'Non-zero exit ("no such user") shows as FAILED, so absent users stand out in red.',
  },
  {
    id: 'mkdir', deck: 'adhoc',
    q: 'What is the ad hoc command to create the directory /tmp/directory1 on every host?',
    answer: 'ansible all -m file -a "path=/tmp/directory1 state=directory"',
    why: 'Idempotent: the second run reports ok instead of changed.',
  },
  {
    id: 'touch', deck: 'adhoc',
    q: 'What is the ad hoc command to create an empty file /tmp/directory1/dev.txt on the dev hosts?',
    answer: 'ansible dev -m file -a "path=/tmp/directory1/dev.txt state=touch"',
    why: 'state=touch reports changed on every run, because it updates the timestamp each time.',
  },
  {
    id: 'ls', deck: 'adhoc',
    q: 'What is the ad hoc command to list /tmp/directory1 in long format on the dev hosts?',
    answer: 'ansible dev -m command -a "ls -l /tmp/directory1/"',
    why: 'command runs without a shell, so pipes, > and * do not work; use the shell module for those.',
  },
];
