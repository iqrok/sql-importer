-- phpMyAdmin SQL Dump
-- version 5.2.1
-- https://www.phpmyadmin.net/
--
-- Host: localhost
-- Generation Time: Nov 05, 2024 at 06:06 AM
-- Server version: 10.4.32-MariaDB
-- PHP Version: 8.2.12

SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
START TRANSACTION;
SET time_zone = "+00:00";

--
-- Database: `test_db`
--

DELIMITER $$
--
-- Procedures
--
CREATE DEFINER=`root`@`localhost` PROCEDURE `p_test` ()   BEGIN
SELECT aa.mahasiswaUsername FROM d_access_proposal aa;
END$$

--
-- Functions
--
CREATE DEFINER=`root`@`localhost` FUNCTION `f_test` () RETURNS INT(11)  BEGIN
RETURN 1;
END$$

DELIMITER ;

-- --------------------------------------------------------

--
-- Table structure for table `d_access_proposal`
--

CREATE TABLE `d_access_proposal` (
  `mahasiswaUsername` varchar(64) NOT NULL,
  `labCode` varchar(64) NOT NULL,
  `proposedDate` date NOT NULL,
  `proposedTimestamp` time DEFAULT NULL,
  `statusCode` varchar(64) DEFAULT NULL,
  `confirmedBy` varchar(54) DEFAULT NULL,
  `createdDate` timestamp NOT NULL DEFAULT current_timestamp()
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `d_access_proposal`
--

INSERT INTO `d_access_proposal` (`mahasiswaUsername`, `labCode`, `proposedDate`, `proposedTimestamp`, `statusCode`, `confirmedBy`, `createdDate`) VALUES
('are@gmail.com', 'LT', '2022-08-19', '12:00:00', 'REJECT', NULL, '2022-08-12 11:07:03'),
('are@gmail.com', 'SKJ', '2022-08-14', '09:46:52', 'ACCEPT', NULL, '2022-08-12 01:47:22'),
('eieieie@gmail.com', 'LT', '2022-08-13', '09:46:52', 'REJECT', NULL, '2022-08-12 01:47:22'),
('esesese@gmail.com', 'SKJ', '2022-08-10', '13:00:00', 'REJECT', NULL, '2022-08-12 11:20:20'),
('muham@mail.ugm.ac.id', 'SKJ', '2022-08-09', '14:00:00', 'IDLE', NULL, '2022-08-12 10:18:01'),
('muham@mail.ugm.ac.id', 'SKJ', '2022-08-08', '13:00:00', 'ACCEPT', NULL, '2022-08-12 14:31:05'),
('nande@gmail.com', 'SKJ', '2022-08-05', '12:00:00', 'ACCEPT', NULL, '2022-08-12 11:19:56');

--
-- Triggers `d_access_proposal`
--
DELIMITER $$
CREATE TRIGGER `t_test` BEFORE INSERT ON `d_access_proposal` FOR EACH ROW SET new.confirmedBy = NULL
$$
DELIMITER ;

-- --------------------------------------------------------

--
-- Table structure for table `d_lab`
--

CREATE TABLE `d_lab` (
  `code` varchar(64) NOT NULL,
  `name` varchar(32) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `d_lab`
--

INSERT INTO `d_lab` (`code`, `name`) VALUES
('LT', 'Tematik'),
('SKJ', 'Kaya Jaringan');

-- --------------------------------------------------------

--
-- Table structure for table `d_user`
--

CREATE TABLE `d_user` (
  `id` int(11) NOT NULL,
  `email` varchar(64) NOT NULL,
  `name` varchar(32) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Dumping data for table `d_user`
--

INSERT INTO `d_user` (`id`, `email`, `name`) VALUES
(1, 'are@gmail.com', NULL),
(2, 'eieieie@gmail.com', NULL),
(3, 'esesese@gmail.com', NULL),
(4, 'muham@mail.ugm.ac.id', NULL),
(5, 'nande@gmail.com', NULL);

-- --------------------------------------------------------

--
-- Table structure for table `d_user_lab`
--

CREATE TABLE `d_user_lab` (
  `id` int(11) NOT NULL,
  `email` varchar(64) DEFAULT NULL,
  `lab` varchar(64) DEFAULT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Indexes for dumped tables
--

--
-- Indexes for table `d_access_proposal`
--
ALTER TABLE `d_access_proposal`
  ADD PRIMARY KEY (`mahasiswaUsername`,`labCode`,`createdDate`) USING BTREE,
  ADD KEY `labCode` (`labCode`),
  ADD KEY `confirmedBy` (`confirmedBy`),
  ADD KEY `statusCode` (`statusCode`),
  ADD KEY `proposedDate` (`proposedDate`,`proposedTimestamp`);

--
-- Indexes for table `d_lab`
--
ALTER TABLE `d_lab`
  ADD PRIMARY KEY (`code`,`name`);

--
-- Indexes for table `d_user`
--
ALTER TABLE `d_user`
  ADD UNIQUE KEY `email` (`email`),
  ADD KEY `name` (`name`);

--
-- Indexes for table `d_user_lab`
--
ALTER TABLE `d_user_lab`
  ADD PRIMARY KEY (`id`),
  ADD UNIQUE KEY `email` (`email`,`lab`),
  ADD KEY `ulab_lab` (`lab`);

--
-- AUTO_INCREMENT for dumped tables
--

--
-- AUTO_INCREMENT for table `d_user_lab`
--
ALTER TABLE `d_user_lab`
  MODIFY `id` int(11) NOT NULL AUTO_INCREMENT;

--
-- Constraints for dumped tables
--

--
-- Constraints for table `d_access_proposal`
--
ALTER TABLE `d_access_proposal`
  ADD CONSTRAINT `access_email` FOREIGN KEY (`mahasiswaUsername`) REFERENCES `d_user` (`email`),
  ADD CONSTRAINT `lab_code` FOREIGN KEY (`labCode`) REFERENCES `d_lab` (`code`);

--
-- Constraints for table `d_user_lab`
--
ALTER TABLE `d_user_lab`
  ADD CONSTRAINT `ulab_email` FOREIGN KEY (`email`) REFERENCES `d_user` (`email`),
  ADD CONSTRAINT `ulab_lab` FOREIGN KEY (`lab`) REFERENCES `d_lab` (`code`);
COMMIT;
