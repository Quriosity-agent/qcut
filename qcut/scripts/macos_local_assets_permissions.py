"""Read-only macOS ACL and path-ancestor checks for the local volume controller."""
import ctypes
import errno
from functools import lru_cache
import os
from pathlib import Path
import stat
import sys


def demand(condition, message):
    if not condition:
        raise PermissionError(message)


@lru_cache(maxsize=1)
def acl_api():
    demand(sys.platform == "darwin", "Native macOS ACL inspection is required")
    library = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)
    library.acl_get_link_np.argtypes = [ctypes.c_char_p, ctypes.c_int]
    library.acl_get_link_np.restype = ctypes.c_void_p
    library.acl_valid.argtypes = [ctypes.c_void_p]
    library.acl_get_entry.argtypes = [ctypes.c_void_p, ctypes.c_int, ctypes.POINTER(ctypes.c_void_p)]
    library.acl_get_tag_type.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_int)]
    library.acl_free.argtypes = [ctypes.c_void_p]
    return library


def read_acl_tags(path):
    library = acl_api()
    ctypes.set_errno(0)
    acl = library.acl_get_link_np(os.fsencode(path), 0x100)  # ACL_TYPE_EXTENDED
    if not acl:
        demand(ctypes.get_errno() == errno.ENOENT, f"Cannot inspect ACL: {path}")
        return []
    try:
        demand(library.acl_valid(acl) == 0, f"Invalid ACL: {path}")
        tags = []
        entry = ctypes.c_void_p()
        for index in range(170):
            ctypes.set_errno(0)
            result = library.acl_get_entry(acl, 0 if index == 0 else -1, ctypes.byref(entry))
            if result == -1:
                demand(ctypes.get_errno() == errno.EINVAL, f"Cannot enumerate ACL: {path}")
                return tags
            demand(result == 0, f"Unexpected ACL entry result: {path}")
            tag = ctypes.c_int()
            demand(library.acl_get_tag_type(entry, ctypes.byref(tag)) == 0, f"Cannot inspect ACL type: {path}")
            tags.append(tag.value)
        raise PermissionError(f"ACL exceeds supported entry count: {path}")
    finally:
        library.acl_free(acl)


def security_identity(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid, info.st_ctime_ns)


def trusted_path(path, *, user_owned=True):
    """Allow deny-only ACLs; root/current-user ancestors cannot be replaceable."""
    path = Path(path)
    demand(path.is_absolute() and path.resolve() == path, f"Noncanonical trusted path: {path}")
    child_owner = None
    for index, current in enumerate((path, *path.parents)):
        before = current.lstat()
        demand(not stat.S_ISLNK(before.st_mode), f"Trusted path became a symlink: {current}")
        allowed_owners = {os.getuid()} if index == 0 and user_owned else {0, os.getuid()}
        demand(before.st_uid in allowed_owners, f"Untrusted owner: {current}")
        if index:
            demand(stat.S_ISDIR(before.st_mode), f"Ancestor is not a directory: {current}")
        if before.st_mode & 0o022:
            # A trusted sticky ancestor protects its already existing trusted child.
            # The leaf itself may not be shared: it can contain future control files.
            demand(index > 0 and before.st_mode & stat.S_ISVTX and child_owner in {0, os.getuid()},
                   f"Writable trusted path or ancestor: {current}")
        tags = read_acl_tags(current)
        # ACL_EXTENDED_DENY=2. Even owner-only allow grants can bypass mode 000.
        demand(all(tag == 2 for tag in tags), f"Allow or unknown ACL entry on trusted path: {current}")
        demand(security_identity(before) == security_identity(current.lstat()),
               f"Trusted path changed during permission inspection: {current}")
        child_owner = before.st_uid
