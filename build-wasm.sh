#!/bin/bash
mkdir -p src/assets/wasm

cd visc-lib
mkdir -p build && cd build
emcmake cmake ..
emmake make

cd ../..
cp visc-lib/build/visc.wasm src/assets/wasm/
cp visc-lib/build/visc.js src/assets/wasm/

echo "Wasm successfully builded and is located in the src/assets/wasm/"