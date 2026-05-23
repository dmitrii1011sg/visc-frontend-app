#!/bin/bash
mkdir -p src/assets/wasm

cd visc-core
mkdir -p build && cd build
emcmake cmake ..
emmake make

cd ../..
cp visc-core/build/visc.wasm src/assets/wasm/
cp visc-core/build/visc.js src/assets/wasm/

echo "Wasm successfully builded and is located in the src/assets/wasm/"