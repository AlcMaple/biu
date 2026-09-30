/** OpenSSH POSIX rename atomically replaces an existing destination; SFTP v3 rename does not. */
export function replaceRemoteFile(sftp, source, target) {
  return new Promise((resolve, reject) => {
    const fail = error =>
      reject(
        new Error("SFTP 原子替换失败：需要服务器支持 posix-rename@openssh.com；未删除原有更新清单", { cause: error }),
      );
    try {
      sftp.ext_openssh_rename(source, target, error => (error ? fail(error) : resolve()));
    } catch (error) {
      fail(error);
    }
  });
}
