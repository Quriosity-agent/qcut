"use client";

import { motion } from "motion/react";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { RiTwitterXLine } from "react-icons/ri";
import { FaGithub } from "react-icons/fa6";
import { getStars } from "@/lib/fetch-github-stars";
import { getAssetPath } from "@/lib/asset-path";

export function Footer() {
  const [star, setStar] = useState<string>();

  useEffect(() => {
    const fetchStars = async () => {
      try {
        const data = await getStars();
        setStar(data);
      } catch (err) {
        console.error("Failed to fetch GitHub stars", err);
      }
    };

    fetchStars();
  }, []);

  return (
    <motion.footer
      className="bg-background border-t"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.8, duration: 0.8 }}
    >
      <div className="max-w-5xl mx-auto px-8 py-10">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mb-8">
          {/* Brand Section */}
          <div className="md:col-span-1 max-w-sm">
            <div className="flex justify-start items-center gap-2 mb-4">
              <img
                src={getAssetPath("assets/logo-v4.png")}
                alt="QCut"
                className="h-6 w-6"
              />
              <span className="font-bold text-lg">QCut</span>
            </div>
            <p className="text-sm md:text-left text-muted-foreground mb-5">
              The agentic video creation platform. AI-powered editing,
              generation, and automation on any platform.
            </p>
            <div className="flex justify-start gap-3">
              <a
                href="https://github.com/donghaozhang/qcut"
                className="text-muted-foreground hover:text-foreground transition-colors"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Visit QCut GitHub repository"
              >
                <FaGithub className="h-5 w-5" />
              </a>
              <a
                href="https://x.com/peter6759"
                className="text-muted-foreground hover:text-foreground transition-colors"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Follow QCut on X"
              >
                <RiTwitterXLine className="h-5 w-5" />
              </a>
            </div>
          </div>

          <div className="flex gap-12 justify-start items-start py-2">
            <div>
              <h3 className="font-semibold text-foreground mb-4">Resources</h3>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link
                    to="/privacy"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Privacy policy
                  </Link>
                </li>
                <li>
                  <Link
                    to="/terms"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Terms of use
                  </Link>
                </li>
              </ul>
            </div>

            {/* Company Links */}
            <div>
              <h3 className="font-semibold text-foreground mb-4">Company</h3>
              <ul className="space-y-2 text-sm">
                <li>
                  <Link
                    to="/contributors"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Contributors
                  </Link>
                </li>
                <li>
                  <a
                    href="https://quriosity.com.au/"
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    About
                  </a>
                </li>
              </ul>
            </div>
          </div>
        </div>

        {/* Bottom Section */}
        <div className="pt-2 flex flex-col md:flex-row justify-between items-start gap-4">
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>© 2025 QCut, All Rights Reserved</span>
          </div>
        </div>
      </div>
    </motion.footer>
  );
}
