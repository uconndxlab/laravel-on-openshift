# Fixing Mixed Content Warnings in Laravel

To resolve Laravel assets serving over HTTP instead of HTTPS, you must either force the application scheme or configure trusted proxies so Laravel correctly detects your SSL certificate. This mixed content issue usually happens when your application sits behind a load balancer, reverse proxy, Cloudflare, or a TLS-terminating server.

## Fix 1: Force HTTPS in `AppServiceProvider` (Most Reliable)

The most straightforward fix is to explicitly tell Laravel to generate all URLs and assets using HTTPS when running in your production environment.

1. Open `app/Providers/AppServiceProvider.php`.
2. Import the `URL` facade at the top of the file.
3. Add the `forceScheme` logic inside the `boot` method.

```php
use Illuminate\Support\Facades\URL;

public function boot(): void
{
    if (app()->environment('production')) {
        URL::forceScheme('https');
    }
}
```

## Fix 2: Configure Trusted Proxies

If you are using a load balancer (like AWS ELB, Heroku, Cloudflare, or DigitalOcean), the secure TLS connection ends at the balancer. The balancer passes the request to your actual server over HTTP, causing Laravel to think it is not on a secure connection.

Depending on your Laravel version, configure your application to trust the proxy's forwarded headers.

**For Laravel 11 and newer:** Open `bootstrap/app.php` and add the `trustProxies` configuration to trust all proxies (common for cloud platforms):

```php
->withMiddleware(function (Middleware $middleware) {
    $middleware->trustProxies(at: '*');
})
```

**For Laravel 10 and older:** Open `app/Http/Middleware/TrustProxies.php` and update the `$proxies` property:

```php
protected $proxies = '*';
```

## Fix 3: Update Environment Configuration

Ensure your cache and environment variables are explicitly expecting HTTPS connections.

1. Open your `.env` file and verify `APP_URL` uses `https://`:

   ```env
   APP_URL=https://your-domain.com
   ```

2. Clear your application cache to make sure the changes take effect:

   ```bash
   php artisan config:clear
   php artisan cache:clear
   ```

## Fix 4: Vite-Specific Configuration

If you are using Vite for frontend assets and experiencing mixed content, make sure your server configuration is aware of the secure origin. In `vite.config.js`, make sure `server.origin` matches your `APP_URL`. If the issue persists, you may need to specify the protocol or use standard `asset()` / `vite()` helpers rather than hardcoded relative links.

```js
export default defineConfig({
    server: {
        origin: 'https://your-domain.com',
    },
});
```

---

If you are still seeing mixed-content errors after trying these methods, identify your hosting platform (e.g., AWS, Heroku, Forge, DigitalOcean) and your Laravel version to narrow down server-specific configurations.

## References

1. <https://cleavr.io/cleavr-slice/how-to-fix-mixed-content-error-for-laravel-apps-behind-load-balancer/>
2. <https://www.youtube.com/watch?v=27hQoxpU5Xg>
3. <https://stackoverflow.com/questions/59313620/really-force-http-to-https-in-laravel>
4. <https://laracasts.com/discuss/channels/laravel/laravel-http-and-https>
5. <https://developers.cloudflare.com/ssl/troubleshooting/mixed-content-errors/>
6. <https://dev.to/doozieakshay/stop-the-mix-up-how-to-force-https-in-laravel-and-fix-your-ajax-woes-47n3>
7. <https://stackoverflow.com/questions/28402726/laravel-5-redirect-to-https>
8. <https://stackoverflow.com/questions/34120976/laravel-asset-url-ignoring-https>
9. <https://bobcares.com/blog/digitalocean-load-balancer-x-forwarded-for-the-real-reason-your-client-ips-look-wrong/>
10. <https://www.reddit.com/r/laravel/comments/1hc9l7x/laravel_and_cloudflareaws_waf/>
11. <https://stackoverflow.com/questions/48590221/laravel-not-using-https-for-assets-and-dynamic-routes>
12. <https://github.com/laravel/framework/discussions/44258>
13. <https://securinglaravel.com/in-depth-stealing-password-tokens/>
14. <https://www.youtube.com/watch?v=62fZl8KDEBw>
15. <https://laraveldaily.com/post/middleware-laravel-main-things-to-know>
16. <https://jonathanbird.com.au/blog/how-to-fix-route-login-not-defined-error-in-laravel-13-2026-guide>
17. <https://codecourse.com/watch/snippet-forcing-assets-with-laravel>
18. <https://github.com/statamic/cms/discussions/10432>
19. <https://www.hostinger.com/ca/tutorials/force-https-using-htaccess>
20. <https://stackoverflow.com/questions/79267963/why-are-my-laravel-assets-not-using-https-with-vitejs>
21. <https://www.digitalocean.com/solutions/laravel-hosting>
22. <https://www.acunetix.com/blog/articles/configure-web-server-disclose-identity/>
