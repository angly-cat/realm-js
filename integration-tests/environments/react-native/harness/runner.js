////////////////////////////////////////////////////////////////////////////
//
// Copyright 2016 Realm Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
////////////////////////////////////////////////////////////////////////////

const { MochaRemoteServer } = require("mocha-remote-server");
const { resolve } = require("path");

const rn = require("./react-native-cli");
const android = require("./android-cli");

const PLATFORM_KEY = "--platform";

const projectRoots = [
    // The react-native test app
    resolve(__dirname, ".."),
    // The integration-tests
    resolve(__dirname, "../../.."),
];

async function runApp(platform) {
    const server = new MochaRemoteServer({}, {
        // Accept connections only from the expected platform, to prevent cross-talk when both emulators are open
        id: platform,
    });
    await server.start();

    // Spawn a react-native metro server
    const metro = rn.async("start", `--projectRoots=${projectRoots.join(",")}`,  /*"--verbose", "--reset-cache"*/);
    // Kill metro when the process is killed
    process.on("exit", (code) => {
        metro.kill("SIGHUP");
    });
    // Close the runner if metro closes unexpectedly
    metro.on("close", (code) => {
        if (code !== 0) {
            console.error(`Metro server unexpectedly closed (code = ${code})`);
            process.exit(code);
        }
    });

    if (platform === "android") {
        const devices = android.adb.devices();
        const activeDevices = devices.filter(({ state }) => state === "device");
        if (activeDevices.length === 0) {
            throw new Error("Missing an active device: Attach a device via USB or start an emulator");
        } else {
            // Ensure the device can access the mocha remote server
            android.adb.reverseServerPort(MochaRemoteServer.DEFAULT_CONFIG.port);
        }
        // Ask React Native to run the android app
        rn.sync("run-android", "--no-packager");
    } else if (platform === "ios") {
        // Ask React Native to run the ios app
        rn.sync("run-ios", "--no-packager");
    } else {
        throw new Error(`Unexpected platform ${platform}`);
    }

    // Wait until the tests ends
    return new Promise((resolve) => {
        server.run((failures) => {
            resolve(failures);
        });
    });
}

async function run() {
    // Determine if we're supposed to run the android or ios app
    const platformArgIndex = process.argv.findIndex((arg) => arg.indexOf(PLATFORM_KEY) === 0);
    if (platformArgIndex === -1) {
        throw new Error(`Expected a ${PLATFORM_KEY} runtime argument`);
    } else {
        // Remove the item from the process.argv to avoid confusions
        const [ platformArg ] = process.argv.splice(platformArgIndex, 1);
        const platform = platformArg.slice(PLATFORM_KEY.length + 1);
        // Run the application
        return runApp(platform);
    }
}

run().then(failures => {
    // Exit with a non-zero code if we had failures
    process.exit(failures > 0 ? 1 : 0);
}, err => {
    console.error(err.stack);
    process.exit(2);
});
