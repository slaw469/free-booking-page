# Putting it online

On your own computer, only you can open the booking page. To give clients a link, the app has to run on a server that is always on. This page covers four ways to do that, what each costs, and the two things you must get right on any of them.

Prices and limits below were checked against each host's own documentation on 7 October 2026. Hosts change these often, so look at their pricing page before you commit. Button names in their dashboards may differ slightly from what is written here.

## The two things that matter

### 1. Set a passcode

The dashboard shows your clients' names, emails and notes. Set an environment variable named `ADMIN_PASSCODE` to a long passcode (four random words is fine) on whichever host you use.

If you forget, the app protects you: with no passcode set, the dashboard refuses to open from anywhere except the machine it runs on, and shows a page telling you to set one. The booking page keeps working either way.

### 2. Give it a disk that lasts

Bookings and your settings are saved as two small files in one folder. Many hosts wipe an app's files every time it restarts or redeploys. If that folder is not on a persistent disk, **your bookings disappear on the next restart**.

So on any host: attach a persistent disk (some call it a volume), and set `DATA_DIR` to the path where it is mounted. The app then keeps `bookings.json` and `config.json` there. If the folder cannot be written, the app refuses to start and says why.

## Which host

| Host | Cost | Persistent disk | Sleeps when idle | Good for |
|---|---|---|---|---|
| Render, free plan | $0 | **No.** Files are lost on every restart, redeploy and spin-down | Yes, after 15 minutes. First visit then takes about a minute | Trying it out, showing a friend. Not real bookings |
| Render, Starter plan | $7/month, plus $0.25 per GB of disk per month | Yes | No | Simplest setup that keeps bookings |
| Railway, Hobby plan | $5/month, which includes $5 of usage. This app uses well under that | Yes, volumes up to 5 GB | No | Cheapest fully managed option |
| Fly.io | Pay for what you use: about $2.19/month for the smallest always-on machine, plus $0.15 per GB of volume per month. No free tier for new accounts | Yes | Optional | Lowest cost if you are comfortable with a command line |
| Oracle Cloud "Always Free" VM | $0 | Yes, it is a real server with its own disk | No | Free and persistent, but you set up the server yourself, and Oracle may reclaim idle free instances |

There is no host on this list that is free, keeps your files, and takes five minutes. Free and easy loses your bookings; free and persistent means running your own server. Roughly $2 to $7 a month buys both.

A 1 GB disk is far more than enough. Ten thousand bookings is about 3 MB.

## Settings every host needs

| Variable | Value | Why |
|---|---|---|
| `ADMIN_PASSCODE` | A long passcode | Locks the dashboard |
| `DATA_DIR` | The disk's mount path, for example `/data` | Where bookings and settings are saved. Already set to `/data` if you deploy with the included `Dockerfile` |
| `TRUST_PROXY` | `1` | These hosts sit in front of your app. This makes the rate limits count each visitor separately instead of treating everyone as one address |
| `PORT` | Leave it alone | The host sets it and the app reads it |
| `HOST` | `0.0.0.0`, only if the deploy fails its health check | By default the app listens only to its own machine. It switches to all addresses by itself on Render, Railway and Fly, in the Docker image, and whenever `NODE_ENV=production`. On any other host, set this |

Health check path, if the host asks for one: `/healthz`.

Most hosts deploy from a GitHub repository. Create a **private** repository, and upload the contents of this folder to it. The included `.gitignore` keeps the `data/` folder out, so you never upload real bookings.

## Option A: Render

**Free plan, to try it (bookings will not last):**

1. Sign up at render.com and choose **New**, then **Web Service**. Connect your GitHub repository.
2. Language: **Node**. Build command: `npm install`. Start command: `npm start`. Instance type: **Free**.
3. Under **Environment**, add `ADMIN_PASSCODE` and `TRUST_PROXY` = `1`.
4. Create the service. Your link is the `onrender.com` address it shows.

On the free plan the service stops after 15 minutes without visitors, and every stop wipes the bookings and any settings you changed in the dashboard. Render states this directly: local files "are lost every time the service redeploys, restarts, or spins down", and free services cannot attach a disk.

**Starter plan, for real use:**

1. Same steps, but pick the **Starter** instance type.
2. On the service's **Disks** page, add a disk. Mount path: `/var/data`. Size: 1 GB.
3. Add the environment variable `DATA_DIR` = `/var/data`.
4. Redeploy.

With a disk attached, each redeploy has a few seconds of downtime, because Render stops the old copy before starting the new one.

## Option B: Railway

1. Sign up at railway.com. New accounts get a one-time $5 trial credit; after that the Hobby plan is $5 a month.
2. **New Project**, then deploy from your GitHub repository. Railway finds the `Dockerfile` and uses it.
3. Add a volume: right-click the project canvas (or press Cmd+K), create a volume, and attach it to the service with mount path `/data`.
4. In the service's **Variables**, add `ADMIN_PASSCODE` and `TRUST_PROXY` = `1`. You do not need `DATA_DIR`: the app picks up Railway's volume path on its own.
5. In **Settings**, under networking, generate a public domain. That is your link.

Redeploying a service that has a volume causes a short moment of downtime.

## Option C: Fly.io

Needs the `fly` command-line tool and a payment card. There is no free allowance for new accounts beyond a short trial.

1. Install the tool from fly.io/docs and run `fly auth signup`.
2. In this folder run `fly launch`. Accept the detected `Dockerfile`, pick a region near you, and say no to any database. Do not deploy yet if it asks.
3. Create the disk: `fly volumes create booking_data --size 1` (use the same region).
4. Open the `fly.toml` file that step 2 created and add:

   ```toml
   [mounts]
     source = "booking_data"
     destination = "/data"
   ```

   In the same file, check that `internal_port` is `8080`.
5. Set the secrets: `fly secrets set ADMIN_PASSCODE="your long passcode" TRUST_PROXY=1`
6. Deploy: `fly deploy`. Your link is `https://<app-name>.fly.dev`.

Keep it to one machine (`fly scale count 1`). A volume belongs to a single machine, and two copies of the app would each keep their own separate bookings.

## Option D: A free server you run yourself

Oracle Cloud's Always Free tier includes small virtual machines with real disks (up to two AMD micro instances, 200 GB of storage in total). It costs nothing and your files persist. The trade-offs: sign-up needs a card for verification, you maintain the server, and Oracle may reclaim an Always Free instance that stays below 20% CPU and network use for seven days, which a quiet booking page will be. Keep a copy of `bookings.json`.

The same steps work on any Linux server, including a spare computer at home:

1. Create the server (Ubuntu), and allow inbound traffic on ports 80 and 443 in the provider's firewall settings.
2. Install Node.js 18 or newer.
3. Copy this folder to the server, for example to `/opt/booking`.
4. Start it on boot with a systemd service, `/etc/systemd/system/booking.service`:

   ```ini
   [Unit]
   Description=Free Booking Page
   After=network.target

   [Service]
   WorkingDirectory=/opt/booking
   ExecStart=/usr/bin/node server.js
   Environment=PORT=4517
   Environment=HOST=127.0.0.1
   Environment=DATA_DIR=/var/lib/booking
   Environment="ADMIN_PASSCODE=your long passcode"
   Environment=TRUST_PROXY=1
   Restart=always
   User=www-data

   [Install]
   WantedBy=multi-user.target
   ```

   Then: `sudo mkdir -p /var/lib/booking && sudo chown www-data /var/lib/booking && sudo systemctl enable --now booking`
5. Put HTTPS in front of it. The shortest route is Caddy with a two-line config, which gets a certificate for you:

   ```
   book.yourdomain.com {
     reverse_proxy 127.0.0.1:4517
   }
   ```

   You need a domain name pointed at the server for this.

Do not skip HTTPS. Without it, your passcode and your clients' details travel in the clear.

## Any other host, with Docker

```
docker build -t booking .
docker run -d -p 8080:8080 -v booking-data:/data -e ADMIN_PASSCODE="your long passcode" -e TRUST_PROXY=1 booking
```

The image listens on port 8080 and keeps everything in `/data`. The `Dockerfile` was written for this project but has not been built and run on a real host as part of testing, so treat the first deploy as the test.

## After it is live

1. Open your link on your phone. Make a test booking.
2. Open `/admin`, enter the passcode, and check the booking is there.
3. **Restart the service from the host's dashboard, then look again.** If the booking is gone, the disk is not set up correctly; fix `DATA_DIR` and the mount path before you share the link.
4. Set your name, hours and timezone in the dashboard.
5. Share the `/book` link.

## Backing up

Everything is in two files inside `DATA_DIR`: `bookings.json` and `config.json`. Copy them somewhere now and then. To move hosts, copy those two files to the new disk.

## What hosting does not add

Hosting makes the link public. It does not add email confirmations, reminders or calendar sync; see the README for the full list of what this app does and does not do. There is no captcha, only a limit of 8 bookings per visitor per 10 minutes, so a determined person could still fill your calendar with junk. You can cancel bookings from the dashboard.

## Sources

- Render free plan limits: https://render.com/docs/free
- Render disks: https://render.com/docs/disks and https://render.com/pricing
- Railway plans and volumes: https://docs.railway.com/reference/pricing/plans and https://docs.railway.com/guides/volumes
- Fly.io pricing: https://docs.fly.io/about/pricing
- Oracle Always Free resources: https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm
