package com.biu.app;

import android.os.Bundle;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;

import com.getcapacitor.Bridge;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.BridgeWebViewClient;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        bridge.getWebView().setWebViewClient(new BiliRefererClient(bridge));
    }
}

class BiliRefererClient extends BridgeWebViewClient {
    private static final String REFERER = "https://www.bilibili.com";
    private static final String ORIGIN = "https://www.bilibili.com";
    private static final String UA =
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

    public BiliRefererClient(Bridge bridge) {
        super(bridge);
    }

    @Override
    public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
        String url = request.getUrl() != null ? request.getUrl().toString() : null;
        if (!needsBiliReferer(url)) {
            return super.shouldInterceptRequest(view, request);
        }
        try {
            HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
            conn.setRequestMethod(request.getMethod() != null ? request.getMethod() : "GET");
            conn.setInstanceFollowRedirects(true);
            conn.setConnectTimeout(15000);
            conn.setReadTimeout(30000);

            Map<String, String> reqHeaders = request.getRequestHeaders();
            if (reqHeaders != null) {
                for (Map.Entry<String, String> e : reqHeaders.entrySet()) {
                    String k = e.getKey();
                    if (k == null) continue;
                    String lk = k.toLowerCase();
                    if (lk.equals("referer") || lk.equals("origin") || lk.equals("user-agent") || lk.equals("host")) {
                        continue;
                    }
                    conn.setRequestProperty(k, e.getValue());
                }
            }
            conn.setRequestProperty("Referer", REFERER);
            conn.setRequestProperty("Origin", ORIGIN);
            conn.setRequestProperty("User-Agent", UA);

            int code = conn.getResponseCode();
            String reason = conn.getResponseMessage();
            if (reason == null || reason.isEmpty()) reason = "OK";

            String contentType = conn.getContentType();
            String mime = "application/octet-stream";
            String encoding = null;
            if (contentType != null) {
                String[] parts = contentType.split(";");
                mime = parts[0].trim();
                for (int i = 1; i < parts.length; i++) {
                    String p = parts[i].trim();
                    if (p.toLowerCase().startsWith("charset=")) {
                        encoding = p.substring(8).trim();
                    }
                }
            }

            Map<String, String> respHeaders = new HashMap<>();
            for (Map.Entry<String, List<String>> e : conn.getHeaderFields().entrySet()) {
                if (e.getKey() == null) continue;
                List<String> vals = e.getValue();
                if (vals == null || vals.isEmpty()) continue;
                respHeaders.put(e.getKey(), vals.get(0));
            }
            respHeaders.put("Access-Control-Allow-Origin", "*");

            InputStream is;
            if (code >= 400) {
                is = conn.getErrorStream();
                if (is == null) is = new ByteArrayInputStream(new byte[0]);
            } else {
                is = conn.getInputStream();
            }

            return new WebResourceResponse(mime, encoding, code, reason, respHeaders, is);
        } catch (Exception e) {
            return super.shouldInterceptRequest(view, request);
        }
    }

    private boolean needsBiliReferer(String url) {
        if (url == null) return false;
        return url.contains("bilivideo.com")
            || url.contains("bilivideo.cn")
            || url.contains("hdslb.com")
            || url.contains("akamaized.net")
            || url.contains(".mcdn.bili")
            || url.contains("biliimg.com")
            || url.contains("bilibili.com");
    }
}
