/**
 * ecosystem.config.cjs — PM2 process definition.
 *
 *   pm2 start ecosystem.config.cjs
 *   pm2 save
 *
 * Tuned for Standard B2ats v2 (2 vCPU / 1 GiB RAM):
 *   • fork mode, 1 instance      — clustering would duplicate the WhatsApp session
 *   • 320 MB old-space ceiling   — leaves room for the OS in 1 GiB
 *   • restart if RSS passes 450 MB, which catches a slow leak before the OOM killer does
 */

module.exports = {
    apps: [
        {
            name              : 'quizly',
            script            : 'index.js',
            cwd               : __dirname,
            instances         : 1,
            exec_mode         : 'fork',
            autorestart       : true,
            max_restarts      : 100,
            restart_delay     : 5000,
            min_uptime        : '10s',
            max_memory_restart: '450M',
            node_args         : '--max-old-space-size=320',
            kill_timeout      : 4000,
            watch             : false,
            merge_logs        : true,
            time              : true,
            out_file          : './data/pm2-out.log',
            error_file        : './data/pm2-err.log',
            env               : {
                NODE_ENV : 'production',
                LOG_LEVEL: 'info'
            }
        }
    ]
};
