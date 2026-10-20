// Small, hand-written files under training/ for the worked examples. They are deliberately tiny so a
// learner can check every pipe stage by eye. Worked-example outputs in levels/*.json are verified
// against these exact bytes by the selftest, so edit them together.

const lines = (...rows) => rows.join('\n') + '\n';

export const TRAINING_MTIME = Date.UTC(2026, 2, 1, 9, 0, 0) / 1000;

export const TRAINING = {
  'training/web.log': lines(
    '192.0.2.14 - - [13/Mar/2026:09:00:01 +0000] "GET / HTTP/1.1" 200 5312 "-" "Mozilla/5.0 (X11; Linux x86_64) Firefox/124.0"',
    '192.0.2.27 - - [13/Mar/2026:09:00:04 +0000] "GET /login HTTP/1.1" 200 2210 "-" "Mozilla/5.0 (Macintosh) Safari/605.1.15"',
    '192.0.2.14 - - [13/Mar/2026:09:00:09 +0000] "POST /login HTTP/1.1" 302 - "-" "Mozilla/5.0 (X11; Linux x86_64) Firefox/124.0"',
    '203.0.113.9 - - [13/Mar/2026:09:01:12 +0000] "GET /wp-login.php HTTP/1.1" 404 196 "-" "curl/8.5.0"',
    '203.0.113.9 - - [13/Mar/2026:09:01:13 +0000] "GET /.env HTTP/1.1" 404 196 "-" "curl/8.5.0"',
    '192.0.2.27 - - [13/Mar/2026:09:01:30 +0000] "GET /static/app.js HTTP/1.1" 304 - "-" "Mozilla/5.0 (Macintosh) Safari/605.1.15"',
    '203.0.113.9 - - [13/Mar/2026:09:01:31 +0000] "GET /admin/ HTTP/1.1" 404 196 "-" "curl/8.5.0"',
    '192.0.2.48 - - [13/Mar/2026:09:02:02 +0000] "GET /api/v1/orders HTTP/1.1" 500 87 "-" "Mozilla/5.0 (Windows NT 10.0) Chrome/123.0"',
    '192.0.2.14 - - [13/Mar/2026:09:02:40 +0000] "GET /static/style.css HTTP/1.1" 200 1840 "-" "Mozilla/5.0 (X11; Linux x86_64) Firefox/124.0"',
    '203.0.113.9 - - [13/Mar/2026:09:02:41 +0000] "GET /server-status HTTP/1.1" 403 199 "-" "curl/8.5.0"',
  ),
  'training/secure.log': lines(
    'Mar 13 09:10:01 web-01 sshd[2101]: Accepted publickey for ops_alice from 198.51.100.21 port 50122 ssh2: ED25519 SHA256:k3Fq0example',
    'Mar 13 09:11:15 web-01 sshd[2140]: Invalid user admin from 203.0.113.9 port 40001',
    'Mar 13 09:11:15 web-01 sshd[2140]: Failed password for invalid user admin from 203.0.113.9 port 40001 ssh2',
    'Mar 13 09:11:19 web-01 sshd[2142]: Failed password for root from 203.0.113.9 port 40007 ssh2',
    'Mar 13 09:11:24 web-01 sshd[2145]: Invalid user test from 203.0.113.9 port 40013',
    'Mar 13 09:11:24 web-01 sshd[2145]: Failed password for invalid user test from 203.0.113.9 port 40013 ssh2',
    'Mar 13 09:12:02 web-01 sudo[2201]: ops_alice : TTY=pts/0 ; PWD=/home/ops_alice ; USER=root ; COMMAND=/usr/bin/systemctl restart httpd',
    'Mar 13 09:20:44 web-01 sshd[2260]: Failed password for ops_bob from 198.51.100.22 port 51544 ssh2',
    'Mar 13 09:20:51 web-01 sshd[2260]: Accepted password for ops_bob from 198.51.100.22 port 51544 ssh2',
    'Mar 13 09:30:12 web-01 su[2302]: pam_unix(su-l:session): session opened for user root(uid=0) by ops_bob(uid=1002)',
  ),
  'training/fw.log': lines(
    'Mar 13 09:00:05 web-01 kernel: FINAL_REJECT: IN=eth0 OUT= SRC=203.0.113.9 DST=198.51.100.11 LEN=44 TTL=241 PROTO=TCP SPT=51811 DPT=23',
    'Mar 13 09:00:09 web-01 kernel: FW-OUT: IN= OUT=eth0 SRC=198.51.100.11 DST=192.0.2.53 LEN=72 TTL=64 PROTO=UDP SPT=40211 DPT=53 LEN=52',
    'Mar 13 09:00:12 web-01 kernel: FINAL_REJECT: IN=eth0 OUT= SRC=203.0.113.9 DST=198.51.100.11 LEN=44 TTL=241 PROTO=TCP SPT=51811 DPT=3389',
    'Mar 13 09:00:30 web-01 kernel: FW-OUT: IN= OUT=eth0 SRC=198.51.100.11 DST=192.0.2.80 LEN=60 TTL=64 PROTO=TCP SPT=44102 DPT=443',
    'Mar 13 09:01:02 web-01 kernel: FINAL_REJECT: IN=eth0 OUT= SRC=192.0.2.200 DST=198.51.100.11 LEN=44 TTL=50 PROTO=TCP SPT=60123 DPT=445',
    'Mar 13 09:01:40 web-01 kernel: FW-OUT: IN= OUT=eth0 SRC=198.51.100.11 DST=192.0.2.123 LEN=76 TTL=64 PROTO=UDP SPT=123 DPT=123 LEN=56',
  ),
  'training/metrics.csv': lines(
    'timestamp,host,cpu,mem,disk_io,net_tx_bytes',
    '2026-03-13T09:00:00Z,web-01,31.5,62.0,140,8100000',
    '2026-03-13T09:00:00Z,db-01,44.0,71.5,610,1900000',
    '2026-03-13T09:05:00Z,web-01,35.0,62.4,152,8800000',
    '2026-03-13T09:05:00Z,db-01,N/A,71.9,598,2050000',
    '2026-03-13T09:10:00Z,web-01,28.5,61.8,131,7600000',
    '2026-03-13T09:10:00Z,db-01,52.0,72.2,640,2200000',
    '2026-03-13T09:15:00Z,web-01,40.0',
  ),
  'training/audit.log': lines(
    'type=USER_LOGIN msg=audit(1773393001.104:801): pid=2101 uid=0 auid=1001 ses=4 msg=\'op=login id=1001 exe="/usr/sbin/sshd" hostname=? addr=198.51.100.21 terminal=/dev/pts/0 res=success\'',
    'type=USER_LOGIN msg=audit(1773393075.880:802): pid=2140 uid=0 auid=4294967295 ses=4294967295 msg=\'op=login acct="(invalid user)" exe="/usr/sbin/sshd" hostname=? addr=203.0.113.9 terminal=ssh res=failed\'',
    'type=SYSCALL msg=audit(1773393122.310:803): arch=c000003e syscall=59 success=yes exit=0 ppid=2110 pid=2201 auid=1001 uid=0 gid=0 euid=0 tty=pts0 ses=4 comm="systemctl" exe="/usr/bin/systemctl" key="exec"',
    'type=EXECVE msg=audit(1773393122.310:803): argc=3 a0="systemctl" a1="restart" a2="httpd"',
  ),
  'training/sar.txt': lines(
    'Linux 5.14.0-427.13.1.el9_4.x86_64 (web-01) \t03/13/2026 \t_x86_64_\t(4 CPU)',
    '',
    '09:00:01 AM     CPU     %user     %nice   %system   %iowait    %steal     %idle',
    '09:10:01 AM     all     12.40      0.00      3.10      0.52      0.00     83.98',
    '09:20:01 AM     all     18.75      0.00      4.02      1.10      0.00     76.13',
    '09:30:01 AM     all     64.20      0.00      9.85      0.40      0.00     25.55',
    '09:40:01 AM     all     15.05      0.00      3.66      0.71      0.00     80.58',
    'Average:        all     27.60      0.00      5.16      0.68      0.00     66.56',
  ),
  'training/team_a.txt': lines('alice', 'bob', 'carol', 'dave', 'erin'),
  'training/team_b.txt': lines('bob', 'dave', 'frank', 'grace'),
  'training/uids.txt': lines('alice 1001', 'bob 1002', 'carol 1004', 'svc_backup 1003'),
  'training/shells.txt': lines('alice /bin/bash', 'bob /bin/zsh', 'svc_backup /bin/bash', 'zed /sbin/nologin'),
  'training/hosts_windows.csv': 'host,ip,owner\r\nweb-01,198.51.100.11,ops_alice\r\ndb-01,198.51.100.12,ops_bob\r\n',
  'training/drill/notes.txt': lines('rotate keys', 'patch httpd'),
  'training/drill/empty.log': '',
  'training/drill/.hidden/todo.txt': lines('check cron'),
  'training/drill/report final.txt': lines('draft'),
};
