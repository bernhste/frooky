cmake_minimum_required(VERSION 3.22.1)
project(value-passing-native C)

add_library(receiveFundamentalValue SHARED receiveFundamentalValue.c)
add_library(receiveFundamentalReference SHARED receiveFundamentalReference.c)
add_library(receiveString SHARED receiveString.c)
add_library(loadStage SHARED loadStage.c)
add_library(loadTime SHARED loadTime.c)

find_library(log-lib log)
target_link_libraries(receiveFundamentalValue ${log-lib})
target_link_libraries(receiveFundamentalReference ${log-lib})
target_link_libraries(receiveString ${log-lib})
target_link_libraries(loadTime loadStage)

# one library per startup stage, e.g. libstartupFactory.so with STAGE "factory"
foreach(stage Factory Application Provider)
    string(TOLOWER ${stage} stage_name)
    add_library(startup${stage} SHARED startupStage.c)
    target_compile_definitions(startup${stage} PRIVATE STAGE="${stage_name}")
endforeach()
