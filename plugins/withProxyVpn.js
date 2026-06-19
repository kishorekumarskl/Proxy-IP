const { withAndroidManifest, withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

function withProxyVpnManifest(config) {
  return withAndroidManifest(config, (cfg) => {
    const manifest = cfg.modResults;
    const app = manifest.manifest.application[0];

    const requiredPerms = [
      "android.permission.INTERNET",
      "android.permission.FOREGROUND_SERVICE",
      "android.permission.FOREGROUND_SERVICE_SPECIAL_USE",
      "android.permission.POST_NOTIFICATIONS",
    ];

    if (!manifest.manifest["uses-permission"]) {
      manifest.manifest["uses-permission"] = [];
    }
    const perms = manifest.manifest["uses-permission"];
    for (const perm of requiredPerms) {
      if (!perms.find((p) => p.$["android:name"] === perm)) {
        perms.push({ $: { "android:name": perm } });
      }
    }

    if (!app.service) app.service = [];
    const vpnSvcName = ".ProxyVpnService";
    if (!app.service.find((s) => s.$["android:name"] === vpnSvcName)) {
      app.service.push({
        $: {
          "android:name": vpnSvcName,
          "android:permission": "android.permission.BIND_VPN_SERVICE",
          "android:exported": "false",
          "android:foregroundServiceType": "specialUse",
        },
        "intent-filter": [
          { action: [{ $: { "android:name": "android.net.VpnService" } }] },
        ],
        property: [
          {
            $: {
              "android:name": "android.app.PROPERTY_SPECIAL_USE_FGS_SUBTYPE",
              "android:value": "vpn",
            },
          },
        ],
      });
    }

    return cfg;
  });
}

function withProxyVpnKotlin(config) {
  return withDangerousMod(config, [
    "android",
    async (cfg) => {
      const packageName =
        cfg.android && cfg.android.package
          ? cfg.android.package
          : "com.privateproxyclient";

      const packagePath = packageName.replace(/\./g, "/");
      const javaDir = path.join(
        cfg.modRequest.platformProjectRoot,
        "app/src/main/java",
        packagePath
      );

      fs.mkdirSync(javaDir, { recursive: true });

      const kotlinSrc = path.join(__dirname, "kotlin");

      // All Kotlin files to copy into the Android project
      const files = [
        "ProxyVpnPackage.kt",
        "ProxyVpnModule.kt",
        "ProxyVpnService.kt",
        "Tun2SocksProcess.kt",
      ];

      for (const file of files) {
        const srcPath = path.join(kotlinSrc, file);
        const dstPath = path.join(javaDir, file);
        if (!fs.existsSync(srcPath)) {
          console.warn(`[withProxyVpn] Warning: ${file} not found in plugins/kotlin/`);
          continue;
        }
        let content = fs.readFileSync(srcPath, "utf-8");
        content = content.replace(/PACKAGE_NAME/g, packageName);
        // Also patch the hardcoded package reference in ProxyVpnService.kt
        content = content.replace(
          /com\.privateproxyclient\.(START_VPN|STOP_VPN|VPN_STATUS)/g,
          (_, action) => `${packageName}.${action}`
        );
        fs.writeFileSync(dstPath, content);
        console.log(`[withProxyVpn] Wrote ${file} → ${dstPath}`);
      }

      // Patch MainApplication.kt to register ProxyVpnPackage
      const mainAppPath = path.join(javaDir, "MainApplication.kt");
      if (fs.existsSync(mainAppPath)) {
        let src = fs.readFileSync(mainAppPath, "utf-8");
        if (!src.includes("ProxyVpnPackage")) {
          src = src.replace(
            /import com\.facebook\.react\.PackageList/,
            `import com.facebook.react.PackageList\nimport ${packageName}.ProxyVpnPackage`
          );
          src = src.replace(
            /\/\/\s*add\(MyReactNativePackage\(\)\)/,
            "add(ProxyVpnPackage())"
          );
          if (!src.includes("ProxyVpnPackage()")) {
            src = src.replace(
              /PackageList\(this\)\.packages/,
              "PackageList(this).packages.also { it.add(ProxyVpnPackage()) }"
            );
          }
          fs.writeFileSync(mainAppPath, src);
          console.log("[withProxyVpn] Patched MainApplication.kt");
        }
      }

      return cfg;
    },
  ]);
}

module.exports = function withProxyVpn(config) {
  config = withProxyVpnManifest(config);
  config = withProxyVpnKotlin(config);
  return config;
};
