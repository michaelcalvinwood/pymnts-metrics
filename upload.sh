#!/bin/bash

rsync -a --exclude "node_modules" . root@rt.pymnts.com:/home/metrics/

