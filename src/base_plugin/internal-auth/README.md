# internal-auth

独立插件行：对已通过 Host/Origin 信任栅栏的 loopback / trustedHosts 请求，放行因缺 cookie 产生的 401。

403 仍拒绝。不是把接口公开给外网；不可信网络应改用 token 或 VPN。
