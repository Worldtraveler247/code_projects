// Exam-style scenarios. Each describes a required end state, the way a hands-on exam task
// does, and is graded on what the playbook leaves on the host, not on which words it uses.
//
// These are original practice tasks. They are not Red Hat exam items, which are confidential.
// Their shapes follow the published EX294 objectives: facts, variables, conditionals, and loops.
//
// Every expected value comes from the real servera capture. Each scenario is also run
// silently against a second, differently configured host (the "variant"), because a
// playbook that only works on one host has not really used the fact.

const HEADER = '---\n- name: Exam-style task\n  hosts: all\n  tasks:\n';
const EMPTY_PLAY = `${HEADER}    `;
const indent = (text) => text.split('\n').map((line) => (line ? `    ${line}` : line)).join('\n');
// The play connects as an ordinary user. A task that installs a package, manages a service, or
// writes outside that user's home needs root, so its model answer carries become: true. The
// starter does not: writing that line is part of the answer.
const NEEDS_ROOT = /^- name: .*\n {2}ansible\.builtin\.(dnf|copy|service):/m;
const playbook = (tasks) => (NEEDS_ROOT.test(tasks) ? HEADER.replace('  tasks:', '  become: true\n  tasks:') : HEADER) + indent(tasks);
const BECOME_HINT = ' This task changes the system, so the play needs `become: true`, at the same level as `hosts`.';
export const DELETE = '__DELETE__';

export const EXAM_CHALLENGES = [
  {
    id: 'exam-conditional-install',
    title: 'Install httpd by OS family',
    tier: 5,
    kind: 'scenario',
    prompt: 'Write a playbook that installs the httpd package, but only on hosts in the Red Hat family. Hosts in any other family must be left unchanged.',
    hint: "Run: `ansible servera -m setup | grep os_family`. Put a `when:` on the install task. A condition is a bare expression, with no `{{ }}` around it: `when: ansible_facts['os_family'] == 'RedHat'`.",
    starter: EMPTY_PLAY,
    solution: playbook([
      '- name: Install httpd on Red Hat family hosts',
      '  ansible.builtin.dnf:',
      '    name: httpd',
      '    state: present',
      "  when: ansible_facts['os_family'] == 'RedHat'",
      '',
    ].join('\n')),
    expect: [{ type: 'package', name: 'httpd', installed: true, label: 'httpd is installed on servera' }],
    variants: [{
      label: 'a Debian-family host',
      patch: { os_family: 'Debian', distribution: 'Ubuntu', distribution_major_version: '22', pkg_mgr: 'apt' },
      expect: [{ type: 'package', name: 'httpd', installed: false, label: 'httpd is not installed' }],
    }],
  },
  {
    id: 'exam-version-gate',
    title: 'Install php by version',
    tier: 5,
    kind: 'scenario',
    prompt: 'Write a playbook that installs the php package only on hosts running CentOS with a major version of 9 or higher. A CentOS 8 host, or a host running a different distribution, must not get the package.',
    hint: "Run: `ansible servera -m setup | grep distribution`. Look closely at the major version: it is in quotes, so it is text, not a number. Comparing text with a number fails; convert it first with `| int`. \"9 or higher\" includes 9 itself, so the test is `>= 9`, not `> 9`. Copy the distribution name from the output exactly: the comparison is case-sensitive, so `'Centos'` does not match `'CentOS'`. Two conditions can be written as a list under `when:`, which means both must hold.",
    starter: EMPTY_PLAY,
    solution: playbook([
      '- name: Install php on CentOS 9 and later',
      '  ansible.builtin.dnf:',
      '    name: php',
      '    state: present',
      '  when:',
      "    - ansible_facts['distribution'] == 'CentOS'",
      "    - ansible_facts['distribution_major_version'] | int >= 9",
      '',
    ].join('\n')),
    expect: [{ type: 'package', name: 'php', installed: true, label: 'php is installed on servera (CentOS 9)' }],
    variants: [
      {
        label: 'a CentOS 8 host',
        patch: { distribution_major_version: '8', distribution_version: '8' },
        expect: [{ type: 'package', name: 'php', installed: false, label: 'php is not installed' }],
      },
      {
        label: 'a CentOS 10 host',
        patch: { distribution_major_version: '10', distribution_version: '10' },
        expect: [{ type: 'package', name: 'php', installed: true, label: 'php is installed (10 is higher than 9; comparing as text gets this wrong)' }],
      },
      {
        label: 'a Rocky 9 host',
        patch: { distribution: 'Rocky' },
        expect: [{ type: 'package', name: 'php', installed: false, label: 'php is not installed' }],
      },
    ],
  },
  {
    id: 'exam-hardware-report',
    title: 'Hardware report file',
    tier: 5,
    kind: 'scenario',
    prompt: 'Write a playbook that creates /root/hwreport.txt on each host with exactly these four lines, filled in from that host\'s facts:\n\nHOST=<short hostname>\nMEMORY=<total memory in MB>\nDISK_SIZE_SDA=<size of sda>\nDISK_SIZE_SDB=<size of sdb>\n\nIf a host has no sdb disk, that line must read DISK_SIZE_SDB=NONE.',
    hint: "Run: `ansible servera -m setup -a 'filter=ansible_devices' | grep -E 'sd|size'`. Write the file with `copy` and `content: |` (a block of lines). For the missing disk, a lookup that fails can fall back to a value: `ansible_facts['devices']['sdb']['size'] | default('NONE')`.",
    starter: EMPTY_PLAY,
    solution: playbook([
      '- name: Write the hardware report',
      '  ansible.builtin.copy:',
      '    dest: /root/hwreport.txt',
      '    content: |',
      "      HOST={{ ansible_facts['hostname'] }}",
      "      MEMORY={{ ansible_facts['memtotal_mb'] }}",
      "      DISK_SIZE_SDA={{ ansible_facts['devices']['sda']['size'] | default('NONE') }}",
      "      DISK_SIZE_SDB={{ ansible_facts['devices']['sdb']['size'] | default('NONE') }}",
      '',
    ].join('\n')),
    expect: [{
      type: 'file', path: '/root/hwreport.txt', label: '/root/hwreport.txt on servera has the four lines, with DISK_SIZE_SDB=NONE',
      content: 'HOST=servera\nMEMORY=567\nDISK_SIZE_SDA=20.00 GB\nDISK_SIZE_SDB=NONE\n',
    }],
    variants: [{
      label: 'a host named serverb with a 5 GB sdb disk and 1987 MB of memory',
      patch: { hostname: 'serverb', memtotal_mb: 1987, devices: { sdb: { size: '5.00 GB' } } },
      expect: [{
        type: 'file', path: '/root/hwreport.txt', label: 'the report shows that host\'s own name, memory, and DISK_SIZE_SDB=5.00 GB',
        content: 'HOST=serverb\nMEMORY=1987\nDISK_SIZE_SDA=20.00 GB\nDISK_SIZE_SDB=5.00 GB\n',
      }],
    }],
  },
  {
    id: 'exam-missing-disk',
    title: 'Message for a missing disk',
    tier: 5,
    kind: 'scenario',
    prompt: 'Write a playbook that prints the message "Disk sdb does not exist" on any host that has no sdb device. On a host that does have sdb, the playbook must print nothing.',
    hint: "Run: `ansible servera -m setup -a 'filter=ansible_devices' | grep '^            \"'`. The devices fact is a dictionary keyed by device name. Test for a key with: `when: \"'sdb' not in ansible_facts['devices']\"`. The whole condition needs quotes because it starts with a quote.",
    starter: EMPTY_PLAY,
    solution: playbook([
      '- name: Report a missing sdb disk',
      '  ansible.builtin.debug:',
      '    msg: Disk sdb does not exist',
      "  when: \"'sdb' not in ansible_facts['devices']\"",
      '',
    ].join('\n')),
    expect: [{ type: 'message', text: 'Disk sdb does not exist', present: true, label: 'servera (no sdb) prints "Disk sdb does not exist"' }],
    variants: [{
      label: 'a host that has an sdb disk',
      patch: { devices: { sdb: { size: '5.00 GB' } } },
      expect: [{ type: 'message', text: 'Disk sdb does not exist', present: false, label: 'nothing is printed' }],
    }],
  },
  {
    id: 'exam-low-memory',
    title: 'Low-memory motd',
    tier: 5,
    kind: 'scenario',
    prompt: 'Write a playbook that creates /etc/motd containing the single line "Low memory host" on any host with less than 1024 MB of total memory. Hosts with 1024 MB or more must not get the file.',
    hint: "Run: `ansible servera -m setup | grep memtotal`. The value has no quotes, so it is already a number and can be compared directly: `when: ansible_facts['memtotal_mb'] < 1024`.",
    starter: EMPTY_PLAY,
    solution: playbook([
      '- name: Warn on low memory hosts',
      '  ansible.builtin.copy:',
      '    dest: /etc/motd',
      '    content: "Low memory host\\n"',
      "  when: ansible_facts['memtotal_mb'] < 1024",
      '',
    ].join('\n')),
    expect: [{ type: 'file', path: '/etc/motd', content: 'Low memory host\n', label: '/etc/motd on servera (567 MB) says "Low memory host"' }],
    variants: [
      {
        label: 'a host with 4096 MB of memory',
        patch: { memtotal_mb: 4096 },
        expect: [{ type: 'file', path: '/etc/motd', absent: true, label: '/etc/motd is not created' }],
      },
      {
        label: 'a host with exactly 1024 MB of memory',
        patch: { memtotal_mb: 1024 },
        expect: [{ type: 'file', path: '/etc/motd', absent: true, label: '/etc/motd is not created (1024 is not less than 1024)' }],
      },
    ],
  },
  {
    id: 'exam-set-fact',
    title: 'Memory in GB with set_fact',
    tier: 5,
    kind: 'scenario',
    prompt: 'Write a playbook with two tasks. The first stores the host\'s total memory in gigabytes, rounded to two decimal places, in a variable named mem_gb. The second prints "Memory: <mem_gb> GB" using that variable. On servera that is "Memory: 0.55 GB".',
    hint: "Total memory is in megabytes, so divide by 1024 and round: `(ansible_facts['memtotal_mb'] / 1024) | round(2)`. The parentheses matter, because a filter binds tighter than division. Store it with `ansible.builtin.set_fact`.",
    starter: EMPTY_PLAY,
    solution: playbook([
      '- name: Work out memory in gigabytes',
      '  ansible.builtin.set_fact:',
      "    mem_gb: \"{{ (ansible_facts['memtotal_mb'] / 1024) | round(2) }}\"",
      '',
      '- name: Print memory in gigabytes',
      '  ansible.builtin.debug:',
      '    msg: "Memory: {{ mem_gb }} GB"',
      '',
    ].join('\n')),
    expect: [
      { type: 'var', name: 'mem_gb', equals: '0.55', label: 'mem_gb is 0.55 on servera' },
      { type: 'message', text: 'Memory: 0.55 GB', present: true, label: 'servera prints "Memory: 0.55 GB"' },
    ],
    variants: [{
      label: 'a host with 3072 MB of memory',
      patch: { memtotal_mb: 3072 },
      expect: [
        { type: 'var', name: 'mem_gb', equals: '3.0', label: 'mem_gb is 3.0' },
        { type: 'message', text: 'Memory: 3.0 GB', present: true, label: 'it prints "Memory: 3.0 GB"' },
      ],
    }],
  },
  {
    id: 'exam-loop-mounts',
    title: 'Loop over mounts',
    tier: 5,
    kind: 'scenario',
    prompt: 'Write a playbook that prints one message for every mounted filesystem on the host, in the form "<mount point> uses <filesystem type>". On servera the three messages are "/ uses xfs", "/boot uses xfs", and "/boot/efi uses vfat".',
    hint: "Run: `ansible servera -m setup -a 'filter=ansible_mounts' | grep -E 'mount|fstype'`. `mounts` is a list of dictionaries. Loop over it with `loop: \"{{ ansible_facts['mounts'] }}\"` and read each entry as `item.mount` and `item.fstype`.",
    starter: EMPTY_PLAY,
    solution: playbook([
      '- name: Report every mounted filesystem',
      '  ansible.builtin.debug:',
      '    msg: "{{ item.mount }} uses {{ item.fstype }}"',
      "  loop: \"{{ ansible_facts['mounts'] }}\"",
      '',
    ].join('\n')),
    expect: [
      { type: 'message', text: '/ uses xfs', present: true, label: 'servera prints "/ uses xfs"' },
      { type: 'message', text: '/boot uses xfs', present: true, label: 'servera prints "/boot uses xfs"' },
      { type: 'message', text: '/boot/efi uses vfat', present: true, label: 'servera prints "/boot/efi uses vfat"' },
    ],
    variants: [{
      label: 'a host with two different mounts',
      patch: { mounts: [{ mount: '/', fstype: 'ext4' }, { mount: '/data', fstype: 'xfs' }] },
      expect: [
        { type: 'message', text: '/ uses ext4', present: true, label: 'it prints "/ uses ext4"' },
        { type: 'message', text: '/data uses xfs', present: true, label: 'it prints "/data uses xfs"' },
        { type: 'message', text: '/boot uses xfs', present: false, label: 'it does not print mounts that host lacks' },
      ],
    }],
  },
  {
    id: 'exam-loop-interfaces',
    title: 'Loop over interfaces',
    tier: 5,
    kind: 'scenario',
    prompt: 'Write a playbook that prints "<interface>: <IPv4 address>" for every network interface on the host except the loopback interface, lo. On servera the messages are "enp0s8: 10.0.2.15" and "enp0s9: 192.168.50.11".',
    hint: "Run: `ansible servera -m setup | grep -A4 ansible_interfaces`, then: `ansible servera -m setup -a 'filter=ansible_enp0s8'`. Each interface has its own fact named after it. Inside the loop the name is in `item`, so the lookup uses a variable as the key: `ansible_facts[item]['ipv4']['address']`. Skip `lo` with `when: item != 'lo'`.",
    starter: EMPTY_PLAY,
    solution: playbook([
      '- name: Report the address of each interface',
      '  ansible.builtin.debug:',
      "    msg: \"{{ item }}: {{ ansible_facts[item]['ipv4']['address'] }}\"",
      "  loop: \"{{ ansible_facts['interfaces'] }}\"",
      "  when: item != 'lo'",
      '',
    ].join('\n')),
    expect: [
      { type: 'message', text: 'enp0s8: 10.0.2.15', present: true, label: 'servera prints "enp0s8: 10.0.2.15"' },
      { type: 'message', text: 'enp0s9: 192.168.50.11', present: true, label: 'servera prints "enp0s9: 192.168.50.11"' },
      { type: 'message', text: 'lo: 127.0.0.1', present: false, label: 'the loopback interface is left out' },
    ],
    variants: [{
      label: 'a host whose interfaces are eth0 and lo',
      patch: { interfaces: ['lo', 'eth0'], eth0: { ipv4: { address: '172.16.0.5' } } },
      expect: [
        { type: 'message', text: 'eth0: 172.16.0.5', present: true, label: 'it prints "eth0: 172.16.0.5"' },
        { type: 'message', text: 'lo: 127.0.0.1', present: false, label: 'the loopback interface is left out' },
      ],
    }],
  },
  {
    id: 'exam-hosts-line',
    title: 'Hosts-file line',
    tier: 5,
    kind: 'scenario',
    prompt: 'Write a playbook that creates /root/hosts.line on each host containing one line in /etc/hosts format: the default IPv4 address, the fully qualified domain name, and the short hostname, separated by single spaces. On servera the line is "10.0.2.15 servera.ytt.lab servera".',
    hint: "Run: `ansible servera -m setup | grep -E 'fqdn|hostname'` and `ansible servera -m setup -a 'filter=ansible_default_ipv4'`. Put all three lookups in one `content:` string, and end it with `\\n` so the file ends with a newline.",
    starter: EMPTY_PLAY,
    solution: playbook([
      '- name: Write the hosts line',
      '  ansible.builtin.copy:',
      '    dest: /root/hosts.line',
      "    content: \"{{ ansible_facts['default_ipv4']['address'] }} {{ ansible_facts['fqdn'] }} {{ ansible_facts['hostname'] }}\\n\"",
      '',
    ].join('\n')),
    expect: [{ type: 'file', path: '/root/hosts.line', content: '10.0.2.15 servera.ytt.lab servera\n', label: '/root/hosts.line on servera is "10.0.2.15 servera.ytt.lab servera"' }],
    variants: [{
      label: 'a host named serverb at 192.168.50.12',
      patch: { hostname: 'serverb', fqdn: 'serverb.ytt.lab', default_ipv4: { address: '192.168.50.12' } },
      expect: [{ type: 'file', path: '/root/hosts.line', content: '192.168.50.12 serverb.ytt.lab serverb\n', label: 'the line is "192.168.50.12 serverb.ytt.lab serverb"' }],
    }],
  },
  {
    id: 'exam-custom-fact',
    title: 'Owner from a custom fact',
    tier: 5,
    kind: 'scenario',
    prompt: 'servera has a custom fact file that sets an owner. Write a playbook that creates /root/owner.txt containing "Owner: <owner>", where the owner comes from the custom fact. On a host with no custom facts, the file must contain "Owner: unknown". On servera the content is "Owner: student".',
    hint: "Run: `ansible servera -m setup -a 'filter=ansible_local'`. Custom facts live under `ansible_local`, the one fact that keeps its `ansible_` prefix inside `ansible_facts`. Follow it down to `owner`, and give it a fallback with `| default('unknown')` for hosts that have no custom facts.",
    starter: EMPTY_PLAY,
    solution: playbook([
      '- name: Record the owner from the custom fact',
      '  ansible.builtin.copy:',
      '    dest: /root/owner.txt',
      "    content: \"Owner: {{ ansible_facts['ansible_local']['video']['info']['owner'] | default('unknown') }}\\n\"",
      '',
    ].join('\n')),
    expect: [{ type: 'file', path: '/root/owner.txt', content: 'Owner: student\n', label: '/root/owner.txt on servera says "Owner: student"' }],
    variants: [{
      label: 'a host with no custom facts',
      patch: { ansible_local: DELETE },
      expect: [{ type: 'file', path: '/root/owner.txt', content: 'Owner: unknown\n', label: 'the file says "Owner: unknown"' }],
    }],
  },
  {
    id: 'exam-distribution-list',
    title: 'Install nginx by distribution list',
    tier: 5,
    kind: 'scenario',
    prompt: 'Write a playbook that installs the nginx package only on hosts whose distribution is CentOS, Rocky, or RedHat. A host running any other distribution must not get the package, even one in the same OS family.',
    hint: "Run: `ansible servera -m setup | grep -E 'distribution\"|os_family'`. The family is too wide for this task: Fedora is in the RedHat family too. Test the distribution against a list with `in`: `when: ansible_facts['distribution'] in ['CentOS', 'Rocky', 'RedHat']`.",
    starter: EMPTY_PLAY,
    solution: playbook([
      '- name: Install nginx on the three named distributions',
      '  ansible.builtin.dnf:',
      '    name: nginx',
      '    state: present',
      "  when: ansible_facts['distribution'] in ['CentOS', 'Rocky', 'RedHat']",
      '',
    ].join('\n')),
    expect: [{ type: 'package', name: 'nginx', installed: true, label: 'nginx is installed on servera (CentOS)' }],
    variants: [
      {
        label: 'an Ubuntu host',
        patch: { os_family: 'Debian', distribution: 'Ubuntu', distribution_major_version: '22', pkg_mgr: 'apt' },
        expect: [{ type: 'package', name: 'nginx', installed: false, label: 'nginx is not installed' }],
      },
      {
        label: 'a Rocky host',
        patch: { distribution: 'Rocky' },
        expect: [{ type: 'package', name: 'nginx', installed: true, label: 'nginx is installed (Rocky is on the list)' }],
      },
      {
        label: 'a Fedora host',
        patch: { distribution: 'Fedora', distribution_major_version: '40', distribution_version: '40' },
        expect: [{ type: 'package', name: 'nginx', installed: false, label: 'nginx is not installed (Fedora is in the RedHat family but not on the list)' }],
      },
    ],
  },
  {
    id: 'exam-memory-swap',
    title: 'Install tmux by memory and swap',
    tier: 5,
    kind: 'scenario',
    prompt: 'Write a playbook that installs the tmux package only on hosts that have at least 512 MB of total memory and also have swap space. A host with less than 512 MB, or with no swap at all, must not get the package.',
    hint: "Run: `ansible servera -m setup | grep -E 'memtotal|swaptotal'`. Neither value is in quotes, so both are numbers already and need no `| int`. \"At least 512\" includes 512 itself, so the test is `>=`, not `>`. A host with no swap reports `swaptotal_mb` as `0`.",
    starter: EMPTY_PLAY,
    solution: playbook([
      '- name: Install tmux where there is enough memory and some swap',
      '  ansible.builtin.dnf:',
      '    name: tmux',
      '    state: present',
      '  when:',
      "    - ansible_facts['memtotal_mb'] >= 512",
      "    - ansible_facts['swaptotal_mb'] > 0",
      '',
    ].join('\n')),
    expect: [{ type: 'package', name: 'tmux', installed: true, label: 'tmux is installed on servera (567 MB, 2047 MB of swap)' }],
    variants: [
      {
        label: 'a host with exactly 512 MB of memory',
        patch: { memtotal_mb: 512 },
        expect: [{ type: 'package', name: 'tmux', installed: true, label: 'tmux is installed (512 is at least 512)' }],
      },
      {
        label: 'a host with 511 MB of memory',
        patch: { memtotal_mb: 511 },
        expect: [{ type: 'package', name: 'tmux', installed: false, label: 'tmux is not installed' }],
      },
      {
        label: 'a host with no swap',
        patch: { swaptotal_mb: 0, swapfree_mb: 0 },
        expect: [{ type: 'package', name: 'tmux', installed: false, label: 'tmux is not installed' }],
      },
    ],
  },
  {
    id: 'exam-version-range',
    title: 'Install podman by version range',
    tier: 5,
    kind: 'scenario',
    prompt: 'Write a playbook that installs the podman package only on hosts in the Red Hat family whose major version is 9 or 10. Older and newer versions, and hosts in any other family, must not get the package.',
    hint: "Run: `ansible servera -m setup | grep -E 'os_family|major_version'`. The major version is in quotes, so it is text. As text, \"9\" is not below \"10\", because text is compared one character at a time and \"9\" comes after \"1\". Convert with `| int` before comparing, and give the range both a lower and an upper bound.",
    starter: EMPTY_PLAY,
    solution: playbook([
      '- name: Install podman on Red Hat family versions 9 and 10',
      '  ansible.builtin.dnf:',
      '    name: podman',
      '    state: present',
      '  when:',
      "    - ansible_facts['os_family'] == 'RedHat'",
      "    - ansible_facts['distribution_major_version'] | int >= 9",
      "    - ansible_facts['distribution_major_version'] | int <= 10",
      '',
    ].join('\n')),
    expect: [{ type: 'package', name: 'podman', installed: true, label: 'podman is installed on servera (Red Hat family, version 9)' }],
    variants: [
      {
        label: 'a version 8 host',
        patch: { distribution_major_version: '8', distribution_version: '8' },
        expect: [{ type: 'package', name: 'podman', installed: false, label: 'podman is not installed' }],
      },
      {
        label: 'a version 10 host',
        patch: { distribution_major_version: '10', distribution_version: '10' },
        expect: [{ type: 'package', name: 'podman', installed: true, label: 'podman is installed (10 is in the range)' }],
      },
      {
        label: 'a version 11 host',
        patch: { distribution_major_version: '11', distribution_version: '11' },
        expect: [{ type: 'package', name: 'podman', installed: false, label: 'podman is not installed (11 is above the range)' }],
      },
      {
        label: 'a Debian 10 host',
        patch: { os_family: 'Debian', distribution: 'Debian', distribution_major_version: '10', distribution_version: '10', pkg_mgr: 'apt' },
        expect: [{ type: 'package', name: 'podman', installed: false, label: 'podman is not installed (wrong family)' }],
      },
    ],
  },
  {
    id: 'exam-selinux-gate',
    title: 'Install SELinux tools when enforcing',
    tier: 5,
    kind: 'scenario',
    prompt: 'Write a playbook that installs the policycoreutils-python-utils package only on hosts where SELinux is enabled and in enforcing mode. Hosts in permissive mode, and hosts with SELinux disabled, must not get the package, and the playbook must not fail on them.',
    hint: "Run: `ansible servera -m setup -a 'filter=ansible_selinux'`. The fact is a dictionary, so step into it: `ansible_facts['selinux']['status']`. A host with SELinux disabled reports only the status and has no `mode` key, so asking it for the mode is an error. List the status condition first: Ansible stops at the first condition that is false and never reads the second.",
    starter: EMPTY_PLAY,
    solution: playbook([
      '- name: Install the SELinux tools on enforcing hosts',
      '  ansible.builtin.dnf:',
      '    name: policycoreutils-python-utils',
      '    state: present',
      '  when:',
      "    - ansible_facts['selinux']['status'] == 'enabled'",
      "    - ansible_facts['selinux']['mode'] == 'enforcing'",
      '',
    ].join('\n')),
    expect: [{ type: 'package', name: 'policycoreutils-python-utils', installed: true, label: 'the package is installed on servera (enabled, enforcing)' }],
    variants: [
      {
        label: 'a host in permissive mode',
        patch: { selinux: { mode: 'permissive', config_mode: 'permissive' } },
        expect: [{ type: 'package', name: 'policycoreutils-python-utils', installed: false, label: 'the package is not installed' }],
      },
      {
        label: 'a host with SELinux disabled',
        patch: { selinux: { status: 'disabled', mode: DELETE, config_mode: DELETE, policyvers: DELETE, type: DELETE } },
        expect: [{ type: 'package', name: 'policycoreutils-python-utils', installed: false, label: 'the package is not installed' }],
      },
    ],
  },
  {
    id: 'exam-or-condition',
    title: 'Install tree except on newer CentOS',
    tier: 5,
    kind: 'scenario',
    prompt: 'Write a playbook that installs the tree package on every host except those running CentOS with a major version of 9 or higher. A CentOS 8 host gets the package, and so does a host running a different distribution at any version. servera is CentOS 9, so it must not get the package.',
    hint: "Run: `ansible servera -m setup | grep distribution`. A host qualifies if either thing is true: it is not CentOS, or its version is below 9. A list under `when:` means every condition must hold, which is the wrong logic here. Write one expression joined with `or`, and convert the version with `| int`.",
    starter: EMPTY_PLAY,
    solution: playbook([
      '- name: Install tree everywhere except CentOS 9 and later',
      '  ansible.builtin.dnf:',
      '    name: tree',
      '    state: present',
      "  when: ansible_facts['distribution'] != 'CentOS' or ansible_facts['distribution_major_version'] | int < 9",
      '',
    ].join('\n')),
    expect: [{ type: 'package', name: 'tree', installed: false, label: 'tree is not installed on servera (CentOS 9)' }],
    variants: [
      {
        label: 'a CentOS 8 host',
        patch: { distribution_major_version: '8', distribution_version: '8' },
        expect: [{ type: 'package', name: 'tree', installed: true, label: 'tree is installed (8 is below 9)' }],
      },
      {
        label: 'a Rocky 9 host',
        patch: { distribution: 'Rocky' },
        expect: [{ type: 'package', name: 'tree', installed: true, label: 'tree is installed (not CentOS)' }],
      },
      {
        label: 'a CentOS 10 host',
        patch: { distribution_major_version: '10', distribution_version: '10' },
        expect: [{ type: 'package', name: 'tree', installed: false, label: 'tree is not installed (10 is higher than 9; comparing as text gets this wrong)' }],
      },
    ],
  },
];

// Said once here, not in eleven hints: which scenarios need root follows from the model answer.
for (const challenge of EXAM_CHALLENGES) {
  if (challenge.solution.includes('  become: true\n')) challenge.hint += BECOME_HINT;
}
