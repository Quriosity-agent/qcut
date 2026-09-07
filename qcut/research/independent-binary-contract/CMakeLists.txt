cmake_minimum_required(VERSION 3.16)
project(independent_binary_contracts LANGUAGES CXX)

option(BINARY_CONTRACT_SANITIZERS "Enable fail-closed ASan and UBSan for all contracts" OFF)
option(BINARY_CONTRACT_NATIVE_PROBES "Compile optional macOS arm64 diagnostics" OFF)

enable_testing()
foreach(contract AGFX EDITOR CREATOR LENS)
    set(${contract}_CONTRACT_SANITIZERS ${BINARY_CONTRACT_SANITIZERS} CACHE BOOL "" FORCE)
endforeach()
foreach(contract AGFX EDITOR CREATOR)
    set(${contract}_CONTRACT_NATIVE_PROBE ${BINARY_CONTRACT_NATIVE_PROBES} CACHE BOOL "" FORCE)
endforeach()
set(LENS_CONTRACT_NATIVE_ORACLE ${BINARY_CONTRACT_NATIVE_PROBES} CACHE BOOL "" FORCE)

foreach(contract agfx editor creator lens)
    add_subdirectory(../independent-${contract}-contract ${contract})
endforeach()
