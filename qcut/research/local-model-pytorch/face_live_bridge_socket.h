#pragma once
#import <Foundation/Foundation.h>
#include <arpa/inet.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>
#include <fcntl.h>
#include <poll.h>
#include <algorithm>
#include <chrono>
#include <cerrno>
#include <cstring>
#include <stdexcept>
#include <string>
#include <vector>

namespace qcut_live {
struct Socket {
  int fd = -1;
  ~Socket() { if (fd >= 0) close(fd); }
};
using Clock = std::chrono::steady_clock;

inline void ready(int fd, short events, Clock::time_point deadline) {
  for (;;) {
    const auto remaining = std::chrono::duration_cast<std::chrono::milliseconds>(deadline - Clock::now()).count();
    if (remaining <= 0) throw std::runtime_error("live socket deadline exceeded");
    pollfd item{fd, events, 0};
    const int result = poll(&item, 1, static_cast<int>(remaining));
    if (result < 0 && errno == EINTR) continue;
    if (result <= 0 || !(item.revents & events)) throw std::runtime_error("live socket closed or timed out");
    return;
  }
}

inline void transfer(int fd, void* data, size_t size, bool writing, Clock::time_point deadline) {
  auto* cursor = static_cast<unsigned char*>(data);
  while (size) {
    ready(fd, writing ? POLLOUT : POLLIN, deadline);
    const auto count = writing ? send(fd, cursor, size, 0) : recv(fd, cursor, size, 0);
    if (count < 0 && (errno == EINTR || errno == EAGAIN)) continue;
    if (count <= 0) throw std::runtime_error("truncated live socket exchange");
    cursor += count;
    size -= static_cast<size_t>(count);
  }
}

inline NSDictionary* exchange(NSDictionary* message, const std::vector<unsigned char>& pixels) {
  const char* path = std::getenv("QCUT_FACE_LIVE_SOCKET");
  if (!path || std::strlen(path) > 100 || pixels.size() > 16 * 1024 * 1024)
    throw std::runtime_error("bounded live socket and pixels required");
  NSData* json = [NSJSONSerialization dataWithJSONObject:message options:0 error:nil];
  if (!json || json.length == 0 || json.length > 128 * 1024)
    throw std::runtime_error("bounded live dependency JSON required");
  Socket connection{socket(AF_UNIX, SOCK_STREAM, 0)};
  if (connection.fd < 0 || fcntl(connection.fd, F_SETFL, O_NONBLOCK) != 0)
    throw std::runtime_error("cannot create nonblocking worker socket");
  int enabled = 1;
  if (setsockopt(connection.fd, SOL_SOCKET, SO_NOSIGPIPE, &enabled, sizeof(enabled)) != 0)
    throw std::runtime_error("cannot configure worker socket");
  sockaddr_un address{};
  address.sun_family = AF_UNIX;
  std::memcpy(address.sun_path, path, std::strlen(path) + 1);
  const auto deadline = Clock::now() + std::chrono::seconds(15);
  const int connected = connect(connection.fd, reinterpret_cast<sockaddr*>(&address), sizeof(address));
  if (connected != 0 && errno != EINPROGRESS) throw std::runtime_error("cannot connect to live worker");
  ready(connection.fd, POLLOUT, deadline);
  int error = 0;
  socklen_t length = sizeof(error);
  if (getsockopt(connection.fd, SOL_SOCKET, SO_ERROR, &error, &length) != 0 || error)
    throw std::runtime_error("live worker connection failed");
  uint32_t header[2]{htonl(static_cast<uint32_t>(json.length)), htonl(static_cast<uint32_t>(pixels.size()))};
  transfer(connection.fd, header, sizeof(header), true, deadline);
  transfer(connection.fd, const_cast<void*>(json.bytes), json.length, true, deadline);
  transfer(connection.fd, const_cast<unsigned char*>(pixels.data()), pixels.size(), true, deadline);
  transfer(connection.fd, header, sizeof(header), false, deadline);
  const auto size = ntohl(header[0]);
  if (size == 0 || size > 128 * 1024 || ntohl(header[1]) != 0)
    throw std::runtime_error("invalid live worker response length");
  std::vector<unsigned char> bytes(size);
  transfer(connection.fd, bytes.data(), size, false, deadline);
  id value = [NSJSONSerialization JSONObjectWithData:[NSData dataWithBytes:bytes.data() length:bytes.size()]
                                            options:0 error:nil];
  if (![value isKindOfClass:[NSDictionary class]] || ![value[@"ok"] isEqual:@YES])
    throw std::runtime_error("live worker rejected candidate: " + std::string([[value description] UTF8String] ?: "invalid JSON"));
  return value;
}
}
