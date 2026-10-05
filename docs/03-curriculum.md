# 03 — Curriculum

The MVP is **30 missions across 3 chapters**. Nothing beyond Chapter 3 is MVP scope.

## Chapter 1 — Computer

Topics: filesystem · files · directories · hidden files · permissions · users · processes ·
shell · environment variables · basic Linux commands.

| #   | Mission             | Objective                                                 | Teaches                             |
| --- | ------------------- | --------------------------------------------------------- | ----------------------------------- |
| 01  | **Welcome**         | Open terminal, identify current user, find home directory | `whoami`, `pwd`                     |
| 02  | **Find the Secret** | Find a hidden file                                        | `ls`, `ls -la`, `find`              |
| 03  | **The Wrong Door**  | Get past a file you cannot read                           | permissions: read / write / execute |
| 04  | **Who Am I?**       | Establish your own identity on the box                    | users, groups, UID, GID             |
| 05  | **Process**         | Find a suspicious process                                 | `ps`, `top`                         |
| 06  | **Environment**     | Find a secret environment variable                        | `env`, `printenv`                   |
| 07  | **Log Hunter**      | Find a suspicious event in the logs                       | `cat`, `grep`, `less`               |
| 08  | **Root**            | Understand what root actually is                          | root, privilege, permissions        |
| 09  | **Mini CTF**        | Combine everything so far                                 | —                                   |
| 10  | **Chapter Boss**    | Investigate a compromised Linux machine                   | —                                   |

## Chapter 2 — Network

Topics: IP · DNS · TCP · UDP · ports · client/server · HTTP basics · basic network reconnaissance.

| #   | Mission                | Teaches                                        |
| --- | ---------------------- | ---------------------------------------------- |
| 11  | Addresses              | `localhost`, `127.0.0.1`, private vs public IP |
| 12  | DNS investigation      | domain, DNS, A, AAAA, CNAME, MX, TXT           |
| 13  | Ports                  | 22, 53, 80, 443                                |
| 14  | TCP vs UDP             | connection semantics                           |
| 15  | Client / server        | request/response roles                         |
| 16  | HTTP basics            | the protocol by hand                           |
| 17  | Network reconnaissance | mapping an unknown network                     |
| 18  | Service enumeration    | identifying what listens                       |
| 19  | Network puzzle         | combine the chapter                            |
| 20  | **Chapter Boss**       | —                                              |

## Chapter 3 — Web

Topics: HTTP request/response · headers · cookies · sessions · authentication · authorization ·
basic web vulnerabilities.

| #   | Mission                         | Teaches                                   |
| --- | ------------------------------- | ----------------------------------------- |
| 21  | HTTP request                    | anatomy of a request                      |
| 22  | HTTP response                   | status codes, body                        |
| 23  | Headers                         | what headers control                      |
| 24  | Cookies                         | state on the client                       |
| 25  | Sessions                        | state on the server                       |
| 26  | Login system                    | how auth is wired                         |
| 27  | Authentication vs authorization | the distinction that causes real breaches |
| 28  | IDOR-style authorization puzzle | object-level access control               |
| 29  | Basic injection puzzle          | untrusted input reaching an interpreter   |
| 30  | **Web Security Boss**           | —                                         |

## Post-MVP chapter roadmap

| Chapter | Theme                    | Contents                                                                       |
| ------- | ------------------------ | ------------------------------------------------------------------------------ |
| 4       | **OSINT**                | search, metadata, DNS intelligence, subdomains, public information             |
| 5       | **Advanced Web**         | SQLi, XSS, SSRF, CSRF, file upload, API security, JWT                          |
| 6       | **Windows**              | internals, PowerShell, Active Directory, Kerberos, LDAP                        |
| 7       | **Privilege Escalation** | Linux, Windows, misconfiguration, credentials, services                        |
| 8       | **Reverse Engineering**  | assembly, binary, debugging, memory                                            |
| 9       | **Cloud**                | IAM, containers, secrets, object storage, cloud networking                     |
| 10      | **Red Team**             | recon, initial access, persistence, privesc, lateral movement, defense evasion |
| 11      | **Blue Team**            | logs, SIEM, detection, incident response, forensics, threat hunting            |
| 12      | **Cyber War**            | full attack/defense simulation                                                 |
