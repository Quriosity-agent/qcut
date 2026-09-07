#pragma once

#include "selection.hpp"

#include <cstdint>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

namespace creator_contract {

enum class Operation { update, accept_click, accept_shortcut, reset };

inline constexpr std::string_view global_filter_service = "GlobalFilterService";

struct UpdateFilter {
  static constexpr std::string_view method = "updateGlobalFilter";
  std::string segment_id;
  double raw_intensity;
  bool observed_flag_0x128 = false;
  bool operator==(const UpdateFilter&) const = default;
};

struct ResetFilter {
  static constexpr std::string_view method = "resetGlobalFilter";
  std::string segment_id;
  bool operator==(const ResetFilter&) const = default;
};

struct ControlTelemetry {
  std::string segment_id;
  std::string action;
  std::int64_t control_detail;
  bool operator==(const ControlTelemetry&) const = default;
};

struct Combo {
  std::string tag = "Filter_Segment_Base_Action";
  std::int32_t editor_mode = 1;
  bool dispatch_flag = false;
  std::int32_t observed_policy = 2;
  std::int64_t session_id = 0;
  std::int64_t request_id = -1;
  std::vector<std::variant<UpdateFilter, ResetFilter>> actions;
  std::vector<ControlTelemetry> telemetry;
  bool operator==(const Combo&) const = default;
};

struct BuildRequest {
  const Selection& selection;
  Operation operation;
  double raw_intensity;
  std::int64_t session_id;
};

struct TelemetryRequest { double raw_intensity; };

// QVariant's nonfinite/out-of-int32 conversion is outside this contract.
// Rejection is a QCut policy; output remains unchanged.
bool telemetry_integer(const TelemetryRequest& request, std::int64_t& output) noexcept;
bool build_combo(const BuildRequest& request, Combo& output);

}  // namespace creator_contract
