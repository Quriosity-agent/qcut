cmake_minimum_required(VERSION 3.16)
project(independent_fog_contract LANGUAGES CXX)

option(FOG_CONTRACT_SANITIZERS "Enable fail-closed ASan and UBSan" OFF)
enable_testing()
if(NOT TARGET softglow)
    set(SOFT_GLOW_SANITIZERS ${FOG_CONTRACT_SANITIZERS} CACHE BOOL "" FORCE)
    add_subdirectory(../independent-soft-glow soft-glow-dependency)
endif()

add_library(fog_contract STATIC blur.cpp composite.cpp pipeline.cpp)
target_compile_features(fog_contract PUBLIC cxx_std_20)
target_include_directories(fog_contract PUBLIC "${CMAKE_CURRENT_SOURCE_DIR}")
target_link_libraries(fog_contract PUBLIC softglow)

add_executable(independent-fog main.cpp)
target_link_libraries(independent-fog PRIVATE fog_contract softglow_io)

foreach(unit blur pipeline)
    add_executable(fog-${unit}-tests ${unit}_tests.cpp)
    target_link_libraries(fog-${unit}-tests PRIVATE fog_contract softglow_io)
    add_test(NAME fog-${unit}-contract COMMAND fog-${unit}-tests)
endforeach()

foreach(target fog_contract independent-fog fog-blur-tests fog-pipeline-tests)
    if(MSVC)
        target_compile_options(${target} PRIVATE /W4 /WX /fp:strict)
        if(FOG_CONTRACT_SANITIZERS)
            message(FATAL_ERROR "Combined ASan/UBSan requires Clang or GCC")
        endif()
    else()
        target_compile_options(${target} PRIVATE -Wall -Wextra -Wpedantic -Werror -ffp-contract=off)
        if(FOG_CONTRACT_SANITIZERS)
            target_compile_options(${target} PRIVATE -fsanitize=address,undefined -fno-sanitize-recover=all -fno-omit-frame-pointer)
            target_link_options(${target} PRIVATE -fsanitize=address,undefined -fno-sanitize-recover=all)
        endif()
    endif()
endforeach()

find_package(Python3 COMPONENTS Interpreter QUIET)
if(Python3_Interpreter_FOUND)
    add_test(NAME fog-cli-contract
        COMMAND "${Python3_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/cli_test.py"
            --executable "$<TARGET_FILE:independent-fog>")
    add_test(NAME fog-native-reference-protocol
        COMMAND "${Python3_EXECUTABLE}" -m unittest discover
            -s "${CMAKE_CURRENT_SOURCE_DIR}/../second-filter-native-reference" -p runner_test.py)
    add_test(NAME fog-native-comparison-validation
        COMMAND "${Python3_EXECUTABLE}" -m unittest discover
            -s "${CMAKE_CURRENT_SOURCE_DIR}" -p verify_native_test.py)
endif()
